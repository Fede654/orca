// Fork: wraps raw Opus packets in an Ogg Opus stream (RFC 7845) so a remote dictation
// segment uploads as a small file any ffmpeg-based server reads.

const OGG_LACING_MAX = 255
const OPUS_GRANULE_RATE = 48_000
const STREAM_SERIAL = 0x4f524341 // "ORCA"
const FLAG_BEGIN = 0x02
const FLAG_END = 0x04

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24
    for (let bit = 0; bit < 8; bit += 1) {
      r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    }
    table[i] = r >>> 0
  }
  return table
})()

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0
  }
  return crc
}

export type OggOpusStream = {
  packets: Uint8Array[]
  /** Encoder lookahead in 48 kHz samples, trimmed by the decoder. */
  preSkip: number
  inputSampleRate: number
  /** Samples per packet at the input rate. */
  frameSamples: number
  /** Real input samples: the last packet's padding is trimmed through the end granule. */
  samples: number
}

export function muxOggOpus(stream: OggOpusStream): Uint8Array {
  const pages = [oggPage([opusHead(stream)], 0, 0, FLAG_BEGIN), oggPage([opusTags()], 0, 1, 0)]
  const packetGranule = (stream.frameSamples * OPUS_GRANULE_RATE) / stream.inputSampleRate
  const endGranule =
    stream.preSkip + Math.round((stream.samples * OPUS_GRANULE_RATE) / stream.inputSampleRate)
  let first = 0
  while (first < stream.packets.length || pages.length === 2) {
    // Opus packets are at most 1275 bytes, so one always fits; never stall if not.
    const count = Math.max(
      packetsThatFit(stream.packets, first),
      first < stream.packets.length ? 1 : 0
    )
    const last = first + count >= stream.packets.length
    const granule = last ? endGranule : stream.preSkip + (first + count) * packetGranule
    pages.push(
      oggPage(
        stream.packets.slice(first, first + count),
        granule,
        pages.length,
        last ? FLAG_END : 0
      )
    )
    first += count
  }
  return concat(pages)
}

// A page holds at most 255 lacing values; a packet takes len/255 + 1 of them.
function packetsThatFit(packets: Uint8Array[], first: number): number {
  let lacing = 0
  let count = 0
  for (let i = first; i < packets.length; i += 1) {
    const needed = Math.floor(packets[i].length / OGG_LACING_MAX) + 1
    if (lacing + needed > OGG_LACING_MAX) {
      break
    }
    lacing += needed
    count += 1
  }
  return count
}

function opusHead(stream: OggOpusStream): Uint8Array {
  const head = new Uint8Array(19)
  const view = new DataView(head.buffer)
  head.set(ascii('OpusHead'), 0)
  head[8] = 1 // version
  head[9] = 1 // mono
  view.setUint16(10, stream.preSkip, true)
  view.setUint32(12, stream.inputSampleRate, true)
  // Output gain 0 and channel mapping family 0 stay zeroed.
  return head
}

function opusTags(): Uint8Array {
  const vendor = ascii('orca')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  tags.set(ascii('OpusTags'), 0)
  new DataView(tags.buffer).setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  return tags
}

function oggPage(
  packets: Uint8Array[],
  granule: number,
  sequence: number,
  flags: number
): Uint8Array {
  const lacing: number[] = []
  for (const packet of packets) {
    let remaining = packet.length
    while (remaining >= OGG_LACING_MAX) {
      lacing.push(OGG_LACING_MAX)
      remaining -= OGG_LACING_MAX
    }
    lacing.push(remaining)
  }
  const bodyBytes = packets.reduce((sum, packet) => sum + packet.length, 0)
  const page = new Uint8Array(27 + lacing.length + bodyBytes)
  const view = new DataView(page.buffer)
  page.set(ascii('OggS'), 0)
  page[5] = flags
  view.setBigInt64(6, BigInt(granule), true)
  view.setUint32(14, STREAM_SERIAL, true)
  view.setUint32(18, sequence, true)
  page[26] = lacing.length
  page.set(lacing, 27)
  let offset = 27 + lacing.length
  for (const packet of packets) {
    page.set(packet, offset)
    offset += packet.length
  }
  view.setUint32(22, oggCrc(page), true)
  return page
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
