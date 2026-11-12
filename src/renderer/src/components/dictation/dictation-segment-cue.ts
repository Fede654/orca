import type { SpeechSegmentProgressEvent } from '../../../../shared/speech-types'

// Both cues start as a hint of colour and accelerate toward the cut; the cut itself blinks.
const CUE_START_PERCENT = 15
const PAUSE_END_PERCENT = 90
const LIMIT_END_PERCENT = 100
const CUE_CURVE = 1

function cueMix(progress: number, endPercent: number): number {
  const eased = Math.expm1(CUE_CURVE * Math.min(1, progress)) / Math.expm1(CUE_CURVE)
  return Math.round(CUE_START_PERCENT + (endPercent - CUE_START_PERCENT) * eased)
}

export function dictationSegmentCue(progress: SpeechSegmentProgressEvent | null): {
  kind: 'pause' | 'limit'
  mixPercent: number
} | null {
  if (!progress) {
    return null
  }
  const remainingToLimit = Math.max(0, progress.maxMs - progress.segmentMs)
  if (remainingToLimit < progress.limitWarningMs) {
    const elapsedWarning = progress.limitWarningMs - remainingToLimit
    if (elapsedWarning <= 0 || progress.limitWarningMs <= 0) {
      return null
    }
    return {
      kind: 'limit',
      mixPercent: cueMix(elapsedWarning / progress.limitWarningMs, LIMIT_END_PERCENT)
    }
  }
  if (progress.silenceMs <= 0 || progress.pauseMs <= 0) {
    return null
  }
  return {
    kind: 'pause',
    mixPercent: cueMix(progress.silenceMs / progress.pauseMs, PAUSE_END_PERCENT)
  }
}
