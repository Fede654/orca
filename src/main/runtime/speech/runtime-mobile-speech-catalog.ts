import type { VoiceSettings } from '../../../shared/speech-types'
import type {
  RuntimeSpeechModelSummary,
  RuntimeSpeechSetupState
} from '../../../shared/runtime-worktree-contracts'
import { getDefaultVoiceSettings } from '../../../shared/constants'
import {
  getCatalogModel,
  isLocalSpeechModel,
  SPEECH_MODEL_CATALOG
} from '../../speech/model-catalog'
import { isOfferedSpeechModel } from '../../../shared/speech-model-retirement'
import {
  pinnedSpeechModelId,
  SPEECH_MODEL_PIN_INVALID_ERROR,
  SPEECH_MODEL_PINNED_ERROR
} from '../../speech/speech-model-pin'
import { getSpeechModelManager, getSpeechSttService } from '../../speech/speech-runtime-service'
import { hasLocalSpeechRecognizer } from '../../speech/stt-worker-paths'
import {
  deleteLocalSpeechModel,
  getSpeechModelDeletionErrorCode
} from '../../speech/speech-model-deletion'
import type { RuntimeStore } from '../runtime-store-contract'
import {
  clearOpenAiSpeechApiKey,
  getOpenAiSpeechApiKeyProtection,
  hasOpenAiSpeechApiKey
} from '../../speech/openai-api-key-store'
import { saveVerifiedOpenAiSpeechApiKey } from '../../speech/openai-api-key-verification'
import type { SecretAtRestProtection } from '../../../shared/secret-at-rest-protection'

export type OpenAiSpeechKeyStatus = {
  configured: boolean
  protection: SecretAtRestProtection | null
}

export class RuntimeMobileSpeechCatalog {
  constructor(private readonly getStore: () => RuntimeStore | null) {}

  async list(): Promise<RuntimeSpeechSetupState> {
    const store = this.requireStore()
    const voice = store.getSettings().voice ?? getDefaultVoiceSettings()
    const pin = pinnedSpeechModelId()
    const states = await getSpeechModelManager(store).getModelStates()
    const stateById = new Map(states.map((state) => [state.id, state]))
    // Omit unsupported status variants; older phones could treat them as pickable models.
    // Remote-server models are listed only once this host has a server URL ('ready'): phone builds
    // that predate 'remote' degrade the provider to absent and render the row by status, so an
    // unconfigured remote row would look like a local model and offer a download that must fail.
    const localRunnable = hasLocalSpeechRecognizer()
    const runnable = SPEECH_MODEL_CATALOG.filter(
      (manifest) =>
        isOfferedSpeechModel(manifest) &&
        (localRunnable || !isLocalSpeechModel(manifest)) &&
        (manifest.provider !== 'remote' || stateById.get(manifest.id)?.status === 'ready')
    )
    const models: RuntimeSpeechModelSummary[] = runnable.map((manifest) => {
      const state = stateById.get(manifest.id)
      return {
        id: manifest.id,
        label: manifest.label,
        provider: manifest.provider,
        sizeBytes: manifest.sizeBytes ?? null,
        recommended: manifest.recommended === true,
        status: state?.status ?? 'not-downloaded',
        progress: state?.progress ?? null
      }
    })
    return {
      enabled: voice.enabled === true,
      // A pin is reported even when invalid, so a misconfigured hub shows it.
      selectedModelId: pin.kind === 'none' ? (voice.sttModel ?? '') : pin.id,
      dictationMode: voice.dictationMode === 'hold' ? 'hold' : 'toggle',
      models
    }
  }

  async download(modelId: string): Promise<{ started: true }> {
    const store = this.requireStore()
    const manifest = getCatalogModel(modelId)
    if (!manifest || !isLocalSpeechModel(manifest) || !hasLocalSpeechRecognizer()) {
      throw new Error('voice_model_not_downloadable')
    }
    void getSpeechModelManager(store)
      .downloadModel(modelId)
      .catch((err) =>
        console.error('[runtime] mobile speech model download failed', { modelId, err })
      )
    return { started: true }
  }

  async delete(modelId: string): Promise<RuntimeSpeechSetupState> {
    const store = this.requireWritableStore()
    try {
      await deleteLocalSpeechModel({
        store: {
          getSettings: () => store.getSettings(),
          updateSettings: (updates, options) => store.updateSettings?.(updates, options)
        },
        modelManager: getSpeechModelManager(store),
        sttService: getSpeechSttService(store),
        modelId
      })
    } catch (error) {
      throw new Error(getSpeechModelDeletionErrorCode(error) ?? 'voice_model_delete_failed')
    }
    return this.list()
  }

  async configure(params: {
    enabled?: boolean
    modelId?: string
    dictationMode?: 'toggle' | 'hold'
  }): Promise<RuntimeSpeechSetupState> {
    const store = this.requireWritableStore()
    const current = store.getSettings().voice ?? getDefaultVoiceSettings()
    const pin = pinnedSpeechModelId()
    if (pin.kind === 'invalid') {
      throw new Error(SPEECH_MODEL_PIN_INVALID_ERROR)
    }
    if (pin.kind === 'pinned' && params.modelId !== undefined && params.modelId !== pin.id) {
      throw new Error(SPEECH_MODEL_PINNED_ERROR)
    }
    if (pin.kind === 'none' && params.modelId !== undefined && params.modelId !== '') {
      const manifest = getCatalogModel(params.modelId)
      if (!manifest || !isOfferedSpeechModel(manifest)) {
        throw new Error('voice_model_unknown')
      }
    }
    const nextVoice: VoiceSettings = {
      ...current,
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      // The pin lives in the environment only; it is never written into settings.
      ...(params.modelId !== undefined && pin.kind === 'none' ? { sttModel: params.modelId } : {}),
      ...(params.dictationMode !== undefined ? { dictationMode: params.dictationMode } : {})
    }
    store.updateSettings?.({ voice: nextVoice }, { notifyListeners: true })
    return this.list()
  }

  /** Set cloud dictation keys over RPC for headless hosts without Settings; seal with the transcribing host's secret store. */
  openAiKeyStatus(): OpenAiSpeechKeyStatus {
    return { configured: hasOpenAiSpeechApiKey(), protection: getOpenAiSpeechApiKeyProtection() }
  }

  async setOpenAiKey(apiKey: string): Promise<OpenAiSpeechKeyStatus> {
    await saveVerifiedOpenAiSpeechApiKey(apiKey)
    return this.openAiKeyStatus()
  }

  clearOpenAiKey(): OpenAiSpeechKeyStatus {
    clearOpenAiSpeechApiKey()
    return this.openAiKeyStatus()
  }

  private requireStore(): RuntimeStore {
    const store = this.getStore()
    if (!store) {
      throw new Error('voice_dictation_unavailable')
    }
    return store
  }

  private requireWritableStore(): RuntimeStore {
    const store = this.requireStore()
    if (!store.getSettings || !store.updateSettings) {
      throw new Error('voice_dictation_unavailable')
    }
    return store
  }
}
