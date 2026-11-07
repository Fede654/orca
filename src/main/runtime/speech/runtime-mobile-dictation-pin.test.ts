import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVoiceSettings } from '../../../shared/constants'
import { SPEECH_MODEL_PIN_ENV } from '../../speech/speech-model-pin'
import {
  setSpeechServiceFactories,
  type SpeechServiceFactories
} from '../../speech/speech-runtime-service'
import { RuntimeMobileDictationController } from './runtime-mobile-dictation-controller'
import type { RuntimeStore } from '../runtime-store-contract'

vi.mock('../../speech/stt-worker-paths', () => ({
  hasLocalSpeechRecognizer: () => true,
  LOCAL_SPEECH_UNAVAILABLE_ERROR: 'voice_model_not_ready:unavailable'
}))

const PINNED = 'openai-gpt-4o-mini-transcribe'
const startDictation = vi.fn(async (_modelId: string) => undefined)

beforeEach(() => {
  // A started dictation arms an abandon timer; keep it from firing after the test.
  vi.useFakeTimers()
  startDictation.mockClear()
  const factories = {
    createModelManager: () => ({ getModelState: async () => ({ status: 'ready' }) }),
    createSttService: () => ({ startDictation })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: start() calls only getModelState and startDictation.
  setSpeechServiceFactories(factories as unknown as SpeechServiceFactories)
})

afterEach(() => {
  vi.useRealTimers()
  setSpeechServiceFactories(null)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function controller(): RuntimeMobileDictationController {
  const voice = { ...getDefaultVoiceSettings(), enabled: true, sttModel: 'whisper-tiny' }
  const store = { getSettings: () => ({ voice }) }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: start() reads only getSettings.
  return new RuntimeMobileDictationController(() => store as unknown as RuntimeStore)
}

describe('mobile dictation with a pinned host model', () => {
  it('dictates with the pin instead of the selected model', async () => {
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, PINNED)
    const reply = await controller().start({ dictationId: 'd-1', clientId: 'phone-a' })
    expect(reply.modelId).toBe(PINNED)
    expect(startDictation.mock.calls[0]?.[0]).toBe(PINNED)
  })

  it('refuses a client that names another model', async () => {
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, PINNED)
    await expect(
      controller().start({ dictationId: 'd-1', clientId: 'phone-a', modelId: 'whisper-tiny' })
    ).rejects.toThrow('voice_model_pinned')
    expect(startDictation).not.toHaveBeenCalled()
  })

  it('refuses to dictate while the pin is invalid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, 'no-such-model')
    await expect(controller().start({ dictationId: 'd-1', clientId: 'phone-a' })).rejects.toThrow(
      'voice_model_pin_invalid'
    )
    expect(startDictation).not.toHaveBeenCalled()
  })

  it('uses the selected model when nothing is pinned', async () => {
    await controller().start({ dictationId: 'd-1', clientId: 'phone-a' })
    expect(startDictation.mock.calls[0]?.[0]).toBe('whisper-tiny')
  })
})
