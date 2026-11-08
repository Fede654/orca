// Fork: cuts remote dictation into segments at speaker pauses so each one is transcribed
// while the user keeps talking, instead of one upload when dictation stops.

/** Silence that closes a segment once it is long enough. Tuned for slow speakers. */
export const SEGMENT_PAUSE_MS = 800
/** Shorter segments wait for the next pause: tiny clips lose context at the cut. */
export const SEGMENT_MIN_SECONDS = 4
/** Without a pause, cut at the quietest frame of the last few seconds before this. */
export const SEGMENT_MAX_SECONDS = 20
const QUIET_SEARCH_SECONDS = 5
const FRAME_MS = 20
// About -48 dBFS: quieter frames are silence whatever the room noise.
const MIN_SPEECH_RMS = 0.004
// A frame is speech when it is this many times louder than the tracked noise floor.
const SPEECH_OVER_NOISE = 3
// Below this much speech a segment is breath or noise and is not uploaded.
const MIN_SPEECH_MS = 200
const NOISE_FLOOR_RISE = 0.002

export class RemoteSttSegmenter {
  private readonly frameSamples: number
  private readonly pauseFrames: number
  private readonly minFrames: number
  private readonly maxFrames: number
  private readonly quietSearchFrames: number
  private readonly minSpeechFrames: number
  private pending = new Float32Array(0)
  private frames: Float32Array[] = []
  private frameRms: number[] = []
  private trailingSilentFrames = 0
  private noiseFloor = Number.POSITIVE_INFINITY

  constructor(sampleRate: number) {
    this.frameSamples = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000))
    this.pauseFrames = Math.ceil(SEGMENT_PAUSE_MS / FRAME_MS)
    this.minFrames = Math.round((SEGMENT_MIN_SECONDS * 1000) / FRAME_MS)
    this.maxFrames = Math.round((SEGMENT_MAX_SECONDS * 1000) / FRAME_MS)
    this.quietSearchFrames = Math.round((QUIET_SEARCH_SECONDS * 1000) / FRAME_MS)
    this.minSpeechFrames = Math.ceil(MIN_SPEECH_MS / FRAME_MS)
  }

  /** Returns the segments closed by this audio, oldest first, with speech in them. */
  push(samples: Float32Array): Float32Array[] {
    const ready: Float32Array[] = []
    const input = this.pending.length > 0 ? concat([this.pending, samples]) : samples
    let offset = 0
    for (; offset + this.frameSamples <= input.length; offset += this.frameSamples) {
      const frame = input.slice(offset, offset + this.frameSamples)
      const segment = this.addFrame(frame)
      if (segment) {
        ready.push(segment)
      }
    }
    this.pending = input.slice(offset)
    return ready
  }

  /** Returns what is left when dictation stops, or null when it holds no speech. */
  flush(): Float32Array | null {
    if (this.pending.length > 0) {
      this.frames.push(this.pending)
      this.frameRms.push(rms(this.pending))
      this.pending = new Float32Array(0)
    }
    return this.take(this.frames.length)
  }

  private addFrame(frame: Float32Array): Float32Array | null {
    const level = rms(frame)
    this.frames.push(frame)
    this.frameRms.push(level)
    this.trackNoiseFloor(level)
    this.trailingSilentFrames = this.isSpeech(level) ? 0 : this.trailingSilentFrames + 1
    if (this.frames.length >= this.minFrames && this.trailingSilentFrames >= this.pauseFrames) {
      return this.take(this.frames.length)
    }
    if (this.frames.length >= this.maxFrames) {
      return this.take(this.quietestCut())
    }
    return null
  }

  // Follows quiet stretches down at once and drifts up only on non-speech frames, so long
  // speech never raises it past the voice. A room that gets louder mid-dictation counts
  // as speech, and the maximum length still cuts it.
  private trackNoiseFloor(level: number): void {
    if (level < this.noiseFloor) {
      this.noiseFloor = level
    } else if (!this.isSpeech(level)) {
      this.noiseFloor += (level - this.noiseFloor) * NOISE_FLOOR_RISE
    }
  }

  private isSpeech(level: number): boolean {
    return level >= Math.max(MIN_SPEECH_RMS, this.noiseFloor * SPEECH_OVER_NOISE)
  }

  // Frame count to keep in the segment: cut after the quietest frame near the limit.
  private quietestCut(): number {
    let best = this.frames.length
    let bestLevel = Number.POSITIVE_INFINITY
    for (
      let i = Math.max(0, this.frames.length - this.quietSearchFrames);
      i < this.frames.length;
      i += 1
    ) {
      if (this.frameRms[i] < bestLevel) {
        bestLevel = this.frameRms[i]
        best = i + 1
      }
    }
    return best
  }

  private take(frameCount: number): Float32Array | null {
    const frames = this.frames.splice(0, frameCount)
    const levels = this.frameRms.splice(0, frameCount)
    this.trailingSilentFrames = Math.min(this.trailingSilentFrames, this.frames.length)
    const speechFrames = levels.filter((level) => this.isSpeech(level)).length
    return speechFrames >= this.minSpeechFrames ? concat(frames) : null
  }
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i]
  }
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0
}

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
