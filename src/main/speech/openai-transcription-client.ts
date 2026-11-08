import { resampleToRate } from './stt-audio-resample'
import {
  getRemoteTranscriptionUrl,
  REMOTE_TRANSCRIPTION_MODEL_BY_ID
} from './remote-stt-endpoint-store'
import type { RemoteSttFrameEncoder } from './remote-stt-opus-encoder'
import { RemoteSttSegmenter, type RemoteSttSegment } from './remote-stt-segmenter'

export const OPENAI_TRANSCRIPTION_MODEL_BY_ID: Record<string, string> = {
  'openai-gpt-4o-mini-transcribe': 'gpt-4o-mini-transcribe',
  'openai-gpt-4o-transcribe': 'gpt-4o-transcribe'
}

export const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'
const CLOUD_TRANSCRIPTION_SAMPLE_RATE = 16000
const MAX_CLOUD_AUDIO_SAMPLES = 10 * 60 * CLOUD_TRANSCRIPTION_SAMPLE_RATE
// Room to answer plus the upload time of the WAV at 1 Mbit/s (125 bytes per ms).
const TRANSCRIPTION_RESPONSE_ALLOWANCE_MS = 30_000
const UPLOAD_BYTES_PER_MS = 125

export type OpenAiTranscriptionResponse = {
  text?: unknown
  error?: {
    message?: unknown
  }
}

export function sanitizeOpenAiTranscriptionErrorMessage(message: string): string {
  if (/incorrect api key provided:/i.test(message)) {
    return 'Incorrect OpenAI API key provided.'
  }

  const sanitized = message
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .trim()

  return sanitized || 'OpenAI transcription request failed'
}

function writePcm16Samples(view: DataView, samples: Float32Array, offset: number): void {
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(offset + i * 2, Math.round(value), true)
  }
}

function encodePcm16Wav(chunks: Float32Array[], sampleRate: number): Buffer<ArrayBuffer> {
  const dataBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0) * 2
  const buffer = Buffer.alloc(44 + dataBytes)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let offset = 44
  for (const samples of chunks) {
    writePcm16Samples(view, samples, offset)
    offset += samples.length * 2
  }

  return buffer
}

function wavFile(chunks: Float32Array[]): UploadFile {
  const bytes = encodePcm16Wav(chunks, CLOUD_TRANSCRIPTION_SAMPLE_RATE)
  return {
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    type: 'audio/wav',
    name: 'dictation.wav'
  }
}

export function readOpenAiErrorMessage(data: OpenAiTranscriptionResponse): string | undefined {
  return typeof data.error?.message === 'string'
    ? sanitizeOpenAiTranscriptionErrorMessage(data.error.message)
    : undefined
}

function parseOpenAiTranscriptionResponse(data: OpenAiTranscriptionResponse): string {
  if (typeof data.text === 'string') {
    return data.text.trim()
  }
  throw new Error(
    readOpenAiErrorMessage(data) ?? 'OpenAI transcription response did not include text'
  )
}

/** Fork: delivery of remote segments transcribed while dictation is still running. */
export type RemoteSegmentOptions = {
  onSegment: (text: string) => void
  onError: (message: string) => void
  /** Uploads each segment as Ogg Opus; without one, segments go as WAV. Owned by the session. */
  frameEncoder?: RemoteSttFrameEncoder | null
}

type UploadFile = { bytes: Uint8Array<ArrayBuffer>; type: string; name: string }

export class OpenAiTranscriptionSession {
  private chunks: Float32Array[] = []
  private audioSamples = 0
  private readonly abortController = new AbortController()
  // Remote only: segments upload one at a time, in order, while the user talks.
  private readonly segmenter: RemoteSttSegmenter | null
  private segmentQueue: Promise<void> = Promise.resolve()
  private segmentFailed = false

  constructor(
    private readonly modelId: string,
    private readonly readApiKey: () => string,
    private readonly language?: string,
    // Set for the remote provider: an OpenAI-compatible server reached without credentials.
    private readonly remoteBaseUrl?: string,
    private readonly segmentOptions?: RemoteSegmentOptions
  ) {
    this.segmenter =
      remoteBaseUrl && segmentOptions
        ? new RemoteSttSegmenter(CLOUD_TRANSCRIPTION_SAMPLE_RATE, segmentOptions.frameEncoder)
        : null
  }

  cancel(): void {
    this.chunks = []
    this.audioSamples = 0
    this.abortController.abort()
    this.segmentOptions?.frameEncoder?.free()
  }

  /** Keeps audio up to the 10-minute upload cap; returns true on the chunk that reaches it. */
  feedAudio(samples: Float32Array, sampleRate: number): boolean {
    const room = MAX_CLOUD_AUDIO_SAMPLES - this.audioSamples
    if (this.abortController.signal.aborted || room <= 0) {
      return false
    }
    const normalized = resampleToRate(samples, sampleRate, CLOUD_TRANSCRIPTION_SAMPLE_RATE)
    const kept = normalized.slice(0, room)
    this.audioSamples += kept.length
    if (this.segmenter) {
      if (!this.segmentFailed) {
        for (const segment of this.segmenter.push(kept)) {
          this.queueSegment(segment)
        }
      }
    } else {
      this.chunks.push(kept)
    }
    return this.audioSamples === MAX_CLOUD_AUDIO_SAMPLES
  }

  async finish(): Promise<string> {
    if (this.segmenter) {
      return this.finishSegments(this.segmenter)
    }
    if (this.chunks.length === 0) {
      return ''
    }
    const chunks = this.chunks
    this.chunks = []
    return this.transcribeFile(wavFile(chunks))
  }

  // Earlier segments were delivered as they finished; the tail is returned like a single upload.
  private async finishSegments(segmenter: RemoteSttSegmenter): Promise<string> {
    const tail = segmenter.flush()
    // Every packet is encoded by now; muxing the queued ones needs no encoder.
    this.segmentOptions?.frameEncoder?.free()
    await this.segmentQueue
    if (this.segmentFailed || !tail) {
      return ''
    }
    return this.transcribeWithRetry(tail)
  }

  private queueSegment(segment: RemoteSttSegment): void {
    this.segmentQueue = this.segmentQueue.then(async () => {
      if (this.segmentFailed || this.abortController.signal.aborted) {
        return
      }
      try {
        const text = await this.transcribeWithRetry(segment)
        if (text && !this.abortController.signal.aborted) {
          this.segmentOptions?.onSegment(text)
        }
      } catch (error) {
        // The text already inserted stays; the rest of this dictation is dropped and reported once.
        this.segmentFailed = true
        if (!this.abortController.signal.aborted) {
          this.segmentOptions?.onError(error instanceof Error ? error.message : String(error))
        }
      }
    })
  }

  private async transcribeWithRetry(segment: RemoteSttSegment): Promise<string> {
    const file = this.segmentFile(segment)
    try {
      return await this.transcribeFile(file)
    } catch (error) {
      if (this.abortController.signal.aborted) {
        throw error
      }
      return this.transcribeFile(file)
    }
  }

  private segmentFile(segment: RemoteSttSegment): UploadFile {
    const encoder = this.segmentOptions?.frameEncoder
    if (segment.packets && encoder) {
      const bytes = new Uint8Array(encoder.toOgg(segment.packets, segment.samples.length))
      return { bytes, type: 'audio/ogg', name: 'dictation.ogg' }
    }
    return wavFile([segment.samples])
  }

  private async transcribeFile(file: UploadFile): Promise<string> {
    const apiModel = this.remoteBaseUrl
      ? REMOTE_TRANSCRIPTION_MODEL_BY_ID[this.modelId]
      : OPENAI_TRANSCRIPTION_MODEL_BY_ID[this.modelId]
    if (!apiModel) {
      throw new Error(`Unknown transcription model: ${this.modelId}`)
    }

    const form = new FormData()
    form.append('model', apiModel)
    form.append('response_format', 'json')
    if (this.language) {
      form.append('language', this.language)
    }
    // A named blob satisfies multipart uploads without temporary files.
    form.append('file', new Blob([file.bytes], { type: file.type }), file.name)

    const timeout = AbortSignal.timeout(
      TRANSCRIPTION_RESPONSE_ALLOWANCE_MS + Math.ceil(file.bytes.byteLength / UPLOAD_BYTES_PER_MS)
    )
    try {
      return await this.upload(form, AbortSignal.any([this.abortController.signal, timeout]))
    } catch (error) {
      if (timeout.aborted && !this.abortController.signal.aborted) {
        throw new Error(
          `${this.providerLabel()} transcription timed out. Check your connection and try again.`
        )
      }
      throw error
    }
  }

  private providerLabel(): string {
    return this.remoteBaseUrl ? 'Remote' : 'OpenAI'
  }

  private async upload(form: FormData, signal: AbortSignal): Promise<string> {
    // Remote servers get no credentials: the OpenAI key must never leave for another host.
    const response = await fetch(
      this.remoteBaseUrl ? getRemoteTranscriptionUrl(this.remoteBaseUrl) : OPENAI_TRANSCRIPTION_URL,
      {
        method: 'POST',
        signal,
        headers: this.remoteBaseUrl ? {} : { Authorization: `Bearer ${this.readApiKey()}` },
        body: form
      }
    )

    const data = (await response.json().catch(() => ({}))) as OpenAiTranscriptionResponse
    if (!response.ok) {
      throw new Error(
        `${this.providerLabel()} transcription failed: ${readOpenAiErrorMessage(data) ?? response.statusText}`
      )
    }

    return parseOpenAiTranscriptionResponse(data)
  }
}
