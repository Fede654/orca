import { afterEach, describe, expect, it, vi } from 'vitest'
import { SPEECH_MODEL_PIN_ENV } from '../../speech/speech-model-pin'
import { getDefaultVoiceSettings } from '../../../shared/constants'
import type { SpeechModelState, VoiceSettings } from '../../../shared/speech-types'
import { SPEECH_MODEL_CATALOG } from '../../speech/model-catalog'
import {
  setSpeechServiceFactories,
  type SpeechServiceFactories
} from '../../speech/speech-runtime-service'
import { RuntimeMobileSpeechCatalog } from './runtime-mobile-speech-catalog'
import type { RuntimeStore } from '../runtime-store-contract'

vi.mock('../../speech/stt-worker-paths', () => ({ hasLocalSpeechRecognizer: () => true }))

afterEach(() => {
  setSpeechServiceFactories(null)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const REMOTE_IDS = SPEECH_MODEL_CATALOG.filter((m) => m.provider === 'remote').map((m) => m.id)

function host(states: SpeechModelState[] = []): RuntimeStore {
  const factories = {
    createModelManager: () => ({ getModelStates: async () => states, deleteModel: vi.fn() }),
    createSttService: () => ({ prepareModelForDeletion: vi.fn() })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these tests call only the members stubbed above.
  setSpeechServiceFactories(factories as unknown as SpeechServiceFactories)
  let voice: VoiceSettings = { ...getDefaultVoiceSettings(), sttModel: 'whisper-tiny' }
  const store = {
    getSettings: () => ({ voice }),
    updateSettings: (updates: { voice: VoiceSettings }) => {
      voice = updates.voice
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the catalog reads only getSettings/updateSettings.
  return store as unknown as RuntimeStore
}

describe('RuntimeMobileSpeechCatalog remote-server models', () => {
  it('does not list a remote-server model while this host has no server URL', async () => {
    expect(REMOTE_IDS.length).toBeGreaterThan(0)
    const store = host(REMOTE_IDS.map((id) => ({ id, status: 'not-downloaded' as const })))
    const setup = await new RuntimeMobileSpeechCatalog(() => store).list()
    const listed = setup.models.map((m) => m.id)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.filter((id) => REMOTE_IDS.includes(id))).toEqual([])
  })

  it('lists a configured remote-server model as a ready remote row with no size', async () => {
    const store = host(REMOTE_IDS.map((id) => ({ id, status: 'ready' as const })))
    const setup = await new RuntimeMobileSpeechCatalog(() => store).list()
    const remote = setup.models.filter((m) => REMOTE_IDS.includes(m.id))
    expect(remote.map((m) => m.id)).toEqual(REMOTE_IDS)
    for (const model of remote) {
      expect(model).toMatchObject({ provider: 'remote', status: 'ready', sizeBytes: null })
    }
  })

  it('refuses to download or delete a remote-server model', async () => {
    const store = host(REMOTE_IDS.map((id) => ({ id, status: 'ready' as const })))
    const catalog = new RuntimeMobileSpeechCatalog(() => store)
    await expect(catalog.download(REMOTE_IDS[0])).rejects.toThrow('voice_model_not_downloadable')
    await expect(catalog.delete(REMOTE_IDS[0])).rejects.toThrow('voice_model_not_deletable')
  })
})

describe('RuntimeMobileSpeechCatalog with a pinned host model', () => {
  const PINNED = 'openai-gpt-4o-mini-transcribe'

  it('reports the pin as the selected model and keeps a configured remote row', async () => {
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, PINNED)
    const store = host(REMOTE_IDS.map((id) => ({ id, status: 'ready' as const })))
    const setup = await new RuntimeMobileSpeechCatalog(() => store).list()
    expect(setup.selectedModelId).toBe(PINNED)
    expect(setup.models.some((m) => REMOTE_IDS.includes(m.id))).toBe(true)
  })

  it('refuses another model, accepts the pin, and still changes enabled and mode', async () => {
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, PINNED)
    const store = host()
    const catalog = new RuntimeMobileSpeechCatalog(() => store)
    await expect(catalog.configure({ modelId: 'whisper-tiny' })).rejects.toThrow(
      'voice_model_pinned'
    )
    const setup = await catalog.configure({ modelId: PINNED, enabled: true, dictationMode: 'hold' })
    expect(setup).toMatchObject({ selectedModelId: PINNED, enabled: true, dictationMode: 'hold' })
    // The pin is never written into settings.
    expect(store.getSettings().voice?.sttModel).toBe('whisper-tiny')
  })

  it('fails closed on an invalid pin and still shows it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, 'no-such-model')
    const store = host()
    const catalog = new RuntimeMobileSpeechCatalog(() => store)
    await expect(catalog.configure({ enabled: true })).rejects.toThrow('voice_model_pin_invalid')
    expect((await catalog.list()).selectedModelId).toBe('no-such-model')
  })
})
