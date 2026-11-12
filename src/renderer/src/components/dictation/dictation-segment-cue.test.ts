import { describe, expect, it } from 'vitest'
import type { SpeechSegmentProgressEvent } from '../../../../shared/speech-types'
import { dictationSegmentCue } from './dictation-segment-cue'

const progress = (silenceMs: number, segmentMs: number): SpeechSegmentProgressEvent => ({
  sessionId: 'test',
  silenceMs,
  pauseMs: 1_200,
  segmentMs,
  maxMs: 30_000,
  limitWarningMs: 3_000
})

describe('dictation segment cue', () => {
  it('returns to the base button between pauses and after a cut', () => {
    expect(dictationSegmentCue(progress(0, 4_000))).toBeNull()
    expect(dictationSegmentCue(progress(600, 6_000))).toEqual({
      kind: 'pause',
      mixPercent: 85
    })
    expect(dictationSegmentCue(progress(0, 6_040))).toBeNull()
    expect(dictationSegmentCue(progress(0, 1_000))).toBeNull()
  })

  it('keeps the limit warning through brief silence near 30 seconds', () => {
    expect(dictationSegmentCue(progress(0, 28_500))).toEqual({ kind: 'limit', mixPercent: 35 })
    expect(dictationSegmentCue(progress(40, 28_540))).toEqual({ kind: 'limit', mixPercent: 36 })
  })
})
