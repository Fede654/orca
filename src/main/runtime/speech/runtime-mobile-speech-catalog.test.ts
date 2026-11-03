import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVoiceSettings } from '../../../shared/constants'
import type { SpeechModelState } from '../../../shared/speech-types'
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
})

const REMOTE_IDS = SPEECH_MODEL_CATALOG.filter((m) => m.provider === 'remote').map((m) => m.id)

function host(states: SpeechModelState[] = []): RuntimeStore {
  const factories = {
    createModelManager: () => ({ getModelStates: async () => states, deleteModel: vi.fn() }),
    createSttService: () => ({ prepareModelForDeletion: vi.fn() })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these tests call only the members stubbed above.
  setSpeechServiceFactories(factories as unknown as SpeechServiceFactories)
  const store = {
    getSettings: () => ({ voice: getDefaultVoiceSettings() }),
    updateSettings: vi.fn()
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
