import type { SpeechSegmentProgressEvent } from '../../../../shared/speech-types'

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
      mixPercent: Math.round((elapsedWarning / progress.limitWarningMs) * 70)
    }
  }
  if (progress.silenceMs <= 0 || progress.pauseMs <= 0) {
    return null
  }
  return {
    kind: 'pause',
    mixPercent: Math.round(70 + (progress.silenceMs / progress.pauseMs) * 30)
  }
}
