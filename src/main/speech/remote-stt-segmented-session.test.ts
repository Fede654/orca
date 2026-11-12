import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiTranscriptionSession } from './openai-transcription-client'
import { RemoteSttSegmenter, SEGMENT_MAX_SECONDS } from './remote-stt-segmenter'

const RATE = 16000

function speech(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i += 1) {
    out[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE)
  }
  return out
}

// Room noise well under the speech level, so the tracked floor stays meaningful.
function silence(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i += 1) {
    out[i] = 0.0005 * Math.sin((2 * Math.PI * 50 * i) / RATE)
  }
  return out
}

function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// Feeds audio the way the renderer does: small chunks, not one buffer.
function feed(segmenter: RemoteSttSegmenter, audio: Float32Array): Float32Array[] {
  const out: Float32Array[] = []
  for (let offset = 0; offset < audio.length; offset += 1600) {
    out.push(
      ...segmenter.push(audio.slice(offset, offset + 1600)).map((segment) => segment.samples)
    )
  }
  return out
}

const seconds = (samples: Float32Array): number => samples.length / RATE

describe('RemoteSttSegmenter', () => {
  it('reports the actual silence counter and resets it when speech resumes or a segment closes', () => {
    const progress: number[] = []
    const segmenter = new RemoteSttSegmenter(RATE, null, (silenceMs) => progress.push(silenceMs))
    feed(segmenter, join(silence(0.3), speech(5), silence(0.4)))
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(400)
    feed(segmenter, speech(0.3))
    expect(progress.at(-1)).toBe(0)
    feed(segmenter, silence(0.8))
    expect(progress).toContain(760)
    expect(progress.at(-1)).toBe(0)
  })

  it('does not signal an imminent pause cut before the minimum segment length', () => {
    const progress: number[] = []
    const segmenter = new RemoteSttSegmenter(RATE, null, (silenceMs) => progress.push(silenceMs))
    feed(segmenter, join(silence(0.3), speech(2), silence(1)))
    expect(progress).toEqual([0])
  })

  it('closes a segment at the first 800 ms pause once it is 4 s long', () => {
    const segmenter = new RemoteSttSegmenter(RATE)
    const segments = feed(segmenter, join(silence(0.3), speech(5), silence(1), speech(2)))
    expect(segments).toHaveLength(1)
    expect(seconds(segments[0])).toBeCloseTo(0.3 + 5 + 0.8, 1)
    expect(seconds(segmenter.flush()!.samples)).toBeCloseTo(0.2 + 2, 1)
  })

  it('keeps talking through pauses shorter than 800 ms', () => {
    const segmenter = new RemoteSttSegmenter(RATE)
    expect(feed(segmenter, join(silence(0.3), speech(5), silence(0.6), speech(3)))).toEqual([])
  })

  it('waits for a later pause when the segment is still under 4 s', () => {
    const segmenter = new RemoteSttSegmenter(RATE)
    const segments = feed(
      segmenter,
      join(silence(0.3), speech(2), silence(1), speech(3), silence(1))
    )
    expect(segments).toHaveLength(1)
    expect(seconds(segments[0])).toBeCloseTo(0.3 + 2 + 1 + 3 + 0.8, 1)
  })

  it('cuts speech without pauses before the maximum, at its quietest frame', () => {
    const segmenter = new RemoteSttSegmenter(RATE)
    const dip = new Float32Array(Math.round(0.04 * RATE))
    const segments = feed(segmenter, join(silence(0.3), speech(17), dip, speech(10)))
    expect(segments).toHaveLength(1)
    expect(seconds(segments[0])).toBeLessThanOrEqual(SEGMENT_MAX_SECONDS)
    expect(seconds(segments[0])).toBeCloseTo(0.3 + 17 + 0.02, 1)
  })

  it('never returns segments that hold no speech', () => {
    const segmenter = new RemoteSttSegmenter(RATE)
    expect(feed(segmenter, silence(30))).toEqual([])
    expect(segmenter.flush()).toBeNull()
  })
})

describe('OpenAiTranscriptionSession with a remote server', () => {
  afterEach(() => vi.unstubAllGlobals())

  function remoteSession(onSegment = vi.fn(), onError = vi.fn()): OpenAiTranscriptionSession {
    return new OpenAiTranscriptionSession(
      () => ({
        url: 'http://192.0.2.10:8000/v1/audio/transcriptions',
        model: 'parakeet-tdt-0.6b-v3',
        apiKey: '',
        label: 'Remote'
      }),
      'es',
      { onSegment, onError, frameEncoder: null }
    )
  }

  function stubServer(answer: (call: number) => Promise<Response>): RequestInit[] {
    const calls: RequestInit[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('http://192.0.2.10:8000/v1/audio/transcriptions')
      calls.push(init)
      return answer(calls.length)
    })
    return calls
  }

  const reply = (text: string): Response => new Response(JSON.stringify({ text }))

  it('delivers each segment in order while dictating and returns the tail on finish', async () => {
    let releaseFirst: () => void = () => {}
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve))
    const calls = stubServer(async (call) => {
      if (call === 1) {
        await firstHeld
      }
      return reply(`segment ${call}`)
    })
    const onSegment = vi.fn()
    const session = remoteSession(onSegment)

    session.feedAudio(join(silence(0.3), speech(5), silence(1)), RATE)
    session.feedAudio(join(speech(5), silence(1)), RATE)
    session.feedAudio(speech(2), RATE)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    // The second segment waits for the first answer: one request at a time keeps the order.
    expect(calls).toHaveLength(1)
    releaseFirst()
    await vi.waitFor(() => expect(onSegment).toHaveBeenCalledTimes(2))

    expect(await session.finish()).toBe('segment 3')
    expect(onSegment.mock.calls).toEqual([['segment 1'], ['segment 2']])
    for (const init of calls) {
      expect(init.headers).toEqual({})
      if (!(init.body instanceof FormData)) {
        throw new Error('Expected multipart body')
      }
      expect(init.body.get('language')).toBe('es')
    }
  })

  it('retries a failed segment once', async () => {
    stubServer(async (call) => (call === 1 ? new Response('{}', { status: 502 }) : reply('ok')))
    const onSegment = vi.fn()
    const onError = vi.fn()
    const session = remoteSession(onSegment, onError)

    session.feedAudio(join(silence(0.3), speech(5), silence(1)), RATE)

    await vi.waitFor(() => expect(onSegment).toHaveBeenCalledWith('ok'))
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a segment that fails twice once and drops the rest of the dictation', async () => {
    const calls = stubServer(async () => new Response('{}', { status: 503 }))
    const onSegment = vi.fn()
    const onError = vi.fn()
    const session = remoteSession(onSegment, onError)

    session.feedAudio(join(silence(0.3), speech(5), silence(1)), RATE)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    session.feedAudio(join(speech(5), silence(1), speech(2)), RATE)

    expect(await session.finish()).toBe('')
    expect(calls).toHaveLength(2)
    expect(onError.mock.calls[0][0]).toMatch(/^Remote transcription failed/)
    expect(onSegment).not.toHaveBeenCalled()
  })

  it('delivers nothing after cancel', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    stubServer(async () => {
      await held
      return reply('late')
    })
    const onSegment = vi.fn()
    const session = remoteSession(onSegment)

    session.feedAudio(join(silence(0.3), speech(5), silence(1)), RATE)
    session.cancel()
    release()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(onSegment).not.toHaveBeenCalled()
  })

  it('sends nothing for a silent dictation', async () => {
    const calls = stubServer(async () => reply('never'))
    const session = remoteSession()
    session.feedAudio(silence(10), RATE)
    expect(await session.finish()).toBe('')
    expect(calls).toHaveLength(0)
  })
})
