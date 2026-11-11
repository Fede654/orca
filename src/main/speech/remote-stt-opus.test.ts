import { createDecoder } from 'libopus-wasm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiTranscriptionSession } from './openai-transcription-client'
import { muxOggOpus, oggCrc } from './remote-stt-ogg-opus'
import { createRemoteSttOpusEncoder } from './remote-stt-opus-encoder'
import { RemoteSttSegmenter } from './remote-stt-segmenter'

const RATE = 16000

function speechWithPause(): Float32Array {
  const parts = [0.3, 5, 1, 2]
  const out = new Float32Array(Math.round(parts.reduce((a, b) => a + b) * RATE))
  let offset = Math.round(0.3 * RATE)
  for (const [index, seconds] of parts.slice(1).entries()) {
    const n = Math.round(seconds * RATE)
    if (index !== 1) {
      for (let i = 0; i < n; i += 1) {
        out[offset + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE)
      }
    }
    offset += n
  }
  return out
}

type OggPage = { flags: number; granule: bigint; sequence: number; packets: Uint8Array[] }

// Reads back what muxOggOpus wrote, checking each page's capture pattern and CRC.
function parseOgg(bytes: Uint8Array): OggPage[] {
  const pages: OggPage[] = []
  let offset = 0
  while (offset < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset)
    expect(String.fromCharCode(...bytes.subarray(offset, offset + 4))).toBe('OggS')
    const segments = bytes[offset + 26]
    const lacing = bytes.subarray(offset + 27, offset + 27 + segments)
    const size = 27 + segments + lacing.reduce((a, b) => a + b, 0)
    const page = bytes.slice(offset, offset + size)
    const stored = view.getUint32(22, true)
    new DataView(page.buffer).setUint32(22, 0, true)
    expect(oggCrc(page)).toBe(stored)
    const packets: Uint8Array[] = []
    let start = offset + 27 + segments
    let length = 0
    for (const value of lacing) {
      length += value
      if (value < 255) {
        packets.push(bytes.slice(start, start + length))
        start += length
        length = 0
      }
    }
    pages.push({
      flags: bytes[offset + 5],
      granule: view.getBigInt64(6, true),
      sequence: view.getUint32(18, true),
      packets
    })
    offset += size
  }
  return pages
}

describe('muxOggOpus', () => {
  it('writes OpusHead, OpusTags and audio pages that end on the real sample count', () => {
    const packets = Array.from({ length: 600 }, (_, i) => new Uint8Array(i % 7 === 0 ? 255 : 40))
    const pages = parseOgg(
      muxOggOpus({
        packets,
        preSkip: 312,
        inputSampleRate: RATE,
        frameSamples: 320,
        samples: 191_900
      })
    )

    expect(pages[0].flags).toBe(0x02)
    const head = pages[0].packets[0]
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('OpusHead')
    expect(new DataView(head.buffer).getUint16(10, true)).toBe(312)
    expect(new DataView(head.buffer).getUint32(12, true)).toBe(RATE)
    expect(String.fromCharCode(...pages[1].packets[0].subarray(0, 8))).toBe('OpusTags')
    expect(pages.map((page) => page.sequence)).toEqual(pages.map((_, i) => i))
    expect(pages.at(-1)!.flags).toBe(0x04)
    expect(pages.at(-1)!.granule).toBe(BigInt(312 + 191_900 * 3))
    // A 255-byte packet needs a terminating zero lacing value and survives the round trip.
    expect(pages.slice(2).flatMap((page) => page.packets)).toEqual(packets)
  })
})

describe('remote Opus encoding', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('encodes segments frame by frame into streams libopus decodes to the same length', async () => {
    const encoder = (await createRemoteSttOpusEncoder(RATE))!
    expect(encoder.frameSamples).toBe(320)
    // Let the spare encoder load so the cut starts a fresh stream.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const segmenter = new RemoteSttSegmenter(RATE, encoder)
    const segments = segmenter.push(speechWithPause())
    segments.push(segmenter.flush()!)
    expect(segments).toHaveLength(2)

    const decoder = await createDecoder({ sampleRate: 48000, channels: 1 })
    for (const segment of segments) {
      const ogg = encoder.toOgg(segment.packets!, segment.samples.length)
      // About 24 kbps instead of 256 kbps WAV.
      expect(ogg.length).toBeLessThan((segment.samples.length / RATE) * 4000)
      const audio = parseOgg(ogg)
        .slice(2)
        .flatMap((page) => page.packets)
      const decoded = audio.reduce((total, packet) => total + decoder.decode(packet).length, 0)
      expect(decoded).toBe(segment.packets!.length * 960)
    }
    decoder.free()
    encoder.free()
  })

  it('uploads Ogg Opus to the remote server', async () => {
    const files: File[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (!(init.body instanceof FormData)) {
        throw new Error('Expected multipart body')
      }
      const file = init.body.get('file')
      if (!(file instanceof File)) {
        throw new Error('Expected audio file')
      }
      files.push(file)
      return new Response(JSON.stringify({ text: 'ok' }))
    })
    const onSegment = vi.fn()
    const session = new OpenAiTranscriptionSession(
      () => ({
        url: 'http://192.0.2.10:8000/v1/audio/transcriptions',
        model: 'parakeet-tdt-0.6b-v3',
        apiKey: '',
        label: 'Remote'
      }),
      undefined,
      { onSegment, onError: vi.fn(), frameEncoder: await createRemoteSttOpusEncoder(RATE) }
    )

    session.feedAudio(speechWithPause(), RATE)
    expect(await session.finish()).toBe('ok')

    expect(onSegment).toHaveBeenCalledWith('ok')
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ['dictation.ogg', 'audio/ogg'],
      ['dictation.ogg', 'audio/ogg']
    ])
    const head = new Uint8Array(await files[0].arrayBuffer())
    expect(String.fromCharCode(...head.subarray(0, 4))).toBe('OggS')
  })
})
