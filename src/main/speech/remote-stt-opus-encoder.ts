// Fork: Opus encoding of remote dictation, frame by frame while the user talks, so a
// closed segment uploads as ~24 kbps Ogg Opus instead of 256 kbps WAV.
import type { OpusEncoderHandle } from 'libopus-wasm'
import { muxOggOpus } from './remote-stt-ogg-opus'

const OPUS_BITRATE = 24_000
// Complexity 5 encodes a 7 s segment in ~0.1 s with the same transcripts as 10 (2026-11-08).
const OPUS_COMPLEXITY = 5
export const OPUS_FRAME_MS = 20

export type RemoteSttFrameEncoder = {
  readonly frameSamples: number
  encode(frame: Float32Array): Uint8Array
  /** Starts a fresh stream for the next segment; false when none is ready and the stream continues. */
  restart(): boolean
  toOgg(packets: Uint8Array[], samples: number): Uint8Array
  free(): void
}

/** Null when libopus cannot load: the caller then uploads WAV, as before. */
export async function createRemoteSttOpusEncoder(
  sampleRate: 16000
): Promise<RemoteSttFrameEncoder | null> {
  try {
    const lib = await import('libopus-wasm')
    const make = (): Promise<OpusEncoderHandle> =>
      lib.createEncoder({
        sampleRate,
        channels: 1,
        application: lib.Application.Voip,
        bitrate: OPUS_BITRATE,
        complexity: OPUS_COMPLEXITY
      })
    return new SpareOpusEncoder(await make(), make, sampleRate)
  } catch {
    return null
  }
}

// libopus-wasm has no synchronous reset, and segments close inside the audio loop: a spare
// encoder is created ahead so the next segment starts a clean stream at once.
class SpareOpusEncoder implements RemoteSttFrameEncoder {
  readonly frameSamples: number
  private spare: OpusEncoderHandle | null = null
  private freed = false
  private readonly preSkip: number

  constructor(
    private current: OpusEncoderHandle,
    private readonly make: () => Promise<OpusEncoderHandle>,
    private readonly sampleRate: number
  ) {
    this.frameSamples = current.frameSize
    this.preSkip = Math.round((current.getLookahead() * 48_000) / sampleRate)
    this.refill()
  }

  encode(frame: Float32Array): Uint8Array {
    if (frame.length === this.frameSamples) {
      return this.current.encodeFloat(frame)
    }
    const padded = new Float32Array(this.frameSamples)
    padded.set(frame.subarray(0, this.frameSamples))
    return this.current.encodeFloat(padded)
  }

  restart(): boolean {
    if (!this.spare) {
      return false
    }
    this.current.free()
    this.current = this.spare
    this.spare = null
    this.refill()
    return true
  }

  toOgg(packets: Uint8Array[], samples: number): Uint8Array {
    return muxOggOpus({
      packets,
      preSkip: this.preSkip,
      inputSampleRate: this.sampleRate,
      frameSamples: this.frameSamples,
      samples
    })
  }

  free(): void {
    this.freed = true
    this.current.free()
    this.spare?.free()
    this.spare = null
  }

  private refill(): void {
    void this.make().then(
      (encoder) => {
        if (this.freed || this.spare) {
          encoder.free()
        } else {
          this.spare = encoder
        }
      },
      () => {
        // A missing spare only means the next segment continues this stream.
      }
    )
  }
}
