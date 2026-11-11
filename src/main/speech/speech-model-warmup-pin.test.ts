import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVoiceSettings } from '../../shared/constants'
import { SPEECH_MODEL_PIN_ENV } from './speech-model-pin'
import { startSpeechModelWarmup } from './speech-model-warmup'

const stt = vi.hoisted(() => ({
  setIdleUnloadDelay: vi.fn(),
  prewarm: vi.fn(async () => undefined),
  unloadIdleModel: vi.fn(async () => undefined)
}))
vi.mock('./speech-runtime-service', () => ({
  findSpeechSttService: () => stt,
  getSpeechSttService: () => stt
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  stt.prewarm.mockClear()
  stt.unloadIdleModel.mockClear()
})

const store = {
  getSettings: () => ({
    voice: { ...getDefaultVoiceSettings(), enabled: true, sttModel: 'whisper-tiny' }
  })
}

describe('speech model pre-warm with a pinned host model', () => {
  it('warms the pinned model instead of the selected one', () => {
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, 'openai-gpt-transcribe')
    startSpeechModelWarmup(store)
    expect(stt.prewarm).toHaveBeenCalledWith('openai-gpt-transcribe', 'auto', true)
  })

  it('warms nothing while the pin is invalid', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, 'no-such-model')
    startSpeechModelWarmup(store)
    expect(stt.prewarm).not.toHaveBeenCalled()
    expect(stt.unloadIdleModel).toHaveBeenCalled()
  })
})
