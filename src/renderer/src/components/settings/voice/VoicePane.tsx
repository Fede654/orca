import { UnsealedCredentialNotice } from '../../provider-accounts/UnsealedCredentialNotice'
import type { SecretAtRestProtection } from '../../../../../shared/secret-at-rest-protection'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { getDefaultVoiceSettings } from '../../../../../shared/constants'
import type { SpeechModelManifest, VoiceSettings } from '../../../../../shared/speech-types'
import { Separator } from '../../ui/separator'
import { toast } from 'sonner'
import { useAppStore } from '@/store/index'
import { OpenAiTranscriptionKeyDialog } from './OpenAiTranscriptionKeyDialog'
import { OpenAiTranscriptionSettingsRow } from './OpenAiTranscriptionSettingsRow'
import { RemoteSttEndpointDialog } from './RemoteSttEndpointDialog'
import { RemoteSttEndpointSettingsRow } from './RemoteSttEndpointSettingsRow'
import { handleVoiceDictationToggle } from './voice-dictation-toggle'
import { VoiceDictationSettingsSection } from './VoiceDictationSettingsSection'
import { VoiceSpeechModelSection } from './VoiceSpeechModelSection'
import { matchesSettingsSearch } from '../search/settings-search'
import { getOpenaiTranscriptionSearchEntry } from './voice-pane-search'
import { translate } from '@/i18n/i18n'

type VoicePaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function VoicePane({ settings, updateSettings }: VoicePaneProps): React.JSX.Element {
  // Keep fallback identity stable so parent renders cannot repeat fetch effects.
  const [defaultVoiceSettings] = useState(getDefaultVoiceSettings)
  const voiceSettings = settings.voice ?? defaultVoiceSettings
  const modelStates = useAppStore((s) => s.modelStates)
  const refreshModelStates = useAppStore((s) => s.refreshModelStates)
  const markFeatureTipsSeen = useAppStore((s) => s.markFeatureTipsSeen)
  const settingsSearchQuery = useAppStore((s) => s.settingsSearchQuery ?? '')
  const [catalog, setCatalog] = useState<SpeechModelManifest[]>([])
  const [permissionPending, setPermissionPending] = useState(false)
  const [openAiDialogOpen, setOpenAiDialogOpen] = useState(false)
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState('')
  const [openAiKeyPending, setOpenAiKeyPending] = useState(false)
  const [openAiKeyProtection, setOpenAiKeyProtection] = useState<SecretAtRestProtection | null>(
    null
  )
  const [pendingCloudModelId, setPendingCloudModelId] = useState<string | null>(null)
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false)
  const [remoteUrlDraft, setRemoteUrlDraft] = useState('')
  const [remotePending, setRemotePending] = useState(false)
  const [pendingRemoteModelId, setPendingRemoteModelId] = useState<string | null>(null)
  const mountedRef = useRef(true)
  // Merge async whole-object writes into committed current settings; render snapshots could undo toggles changed during IPC and disable the microphone picker.
  const voiceSettingsRef = useRef(voiceSettings)
  useEffect(() => {
    voiceSettingsRef.current = voiceSettings
  }, [voiceSettings])

  const handlePaneRef = useCallback((node: HTMLDivElement | null): void => {
    mountedRef.current = node !== null
  }, [])

  const updateVoiceSettings = useCallback(
    (updates: Partial<VoiceSettings>): void => {
      updateSettings({
        voice: {
          ...voiceSettingsRef.current,
          ...updates
        }
      })
    },
    [updateSettings]
  )

  useEffect(() => {
    let cancelled = false
    refreshModelStates()
    void window.api.speech
      .getCatalog()
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog)
        }
      })
      .catch(() => {})
    void window.api.speech
      .getOpenAiApiKeyStatus()
      .then((status) => {
        if (cancelled) {
          return
        }
        setOpenAiKeyProtection(status.protection)
        if (status.configured !== voiceSettings.openAiApiKeyConfigured) {
          updateVoiceSettings({ openAiApiKeyConfigured: status.configured })
          refreshModelStates()
        }
      })
      .catch(() => {})
    void window.api.speech
      .getRemoteEndpoint()
      .then((endpoint) => {
        if (!cancelled) {
          setRemoteUrl(endpoint.url)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshModelStates, updateVoiceSettings, voiceSettings.openAiApiKeyConfigured])

  useEffect(() => {
    const cleanup = window.api.speech.onDownloadProgress(() => {
      refreshModelStates()
    })
    return cleanup
  }, [refreshModelStates])

  const toggleVoiceDictation = async (): Promise<void> => {
    await handleVoiceDictationToggle({
      voiceEnabled: voiceSettings.enabled,
      markFeatureTipsSeen,
      updateVoiceSettings,
      requestMicrophonePermission: () =>
        window.api.developerPermissions.request({ id: 'microphone' }),
      setPermissionPending,
      isMounted: () => mountedRef.current,
      notifyPermissionGranted: () =>
        toast.success(
          translate(
            'auto.components.settings.VoicePane.cd9fe37556',
            'Microphone permission granted'
          )
        ),
      notifyPermissionOpenedSystemSettings: () =>
        toast.message(
          translate(
            'auto.components.settings.VoicePane.1eac933202',
            'Opened macOS Privacy & Security. Enable dictation again after granting access.'
          )
        ),
      notifyPermissionRequired: () =>
        toast.message(
          translate(
            'auto.components.settings.VoicePane.f9a9cf6928',
            'Microphone permission is required before enabling voice dictation.'
          )
        ),
      notifyPermissionRequestFailed: () =>
        toast.error(
          translate(
            'auto.components.settings.VoicePane.ad5d036ecc',
            'Could not request microphone permission. Voice dictation was not enabled.'
          )
        )
    })
  }

  const selectedModel = catalog.find((m) => m.id === voiceSettings.sttModel)
  const showOpenAiSettingsRow =
    voiceSettings.openAiApiKeyConfigured ||
    selectedModel?.provider === 'openai' ||
    (settingsSearchQuery.trim() !== '' &&
      matchesSettingsSearch(settingsSearchQuery, getOpenaiTranscriptionSearchEntry()))

  const openOpenAiDialog = (modelId: string | null = null): void => {
    setPendingCloudModelId(modelId)
    setOpenAiApiKeyDraft('')
    setOpenAiDialogOpen(true)
  }

  const saveOpenAiApiKey = async (): Promise<void> => {
    setOpenAiKeyPending(true)
    try {
      await window.api.speech.saveOpenAiApiKey(openAiApiKeyDraft)
      updateVoiceSettings({
        openAiApiKeyConfigured: true,
        sttModel: pendingCloudModelId ?? voiceSettings.sttModel
      })
      await refreshModelStates()
      setOpenAiDialogOpen(false)
      setOpenAiApiKeyDraft('')
      setPendingCloudModelId(null)
      toast.success(
        translate('auto.components.settings.VoicePane.506df81ba6', 'OpenAI API key saved')
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translate(
              'auto.components.settings.VoicePane.8572bbb537',
              'Failed to save OpenAI API key'
            )
      )
    } finally {
      if (mountedRef.current) {
        setOpenAiKeyPending(false)
      }
    }
  }

  const openRemoteDialog = (modelId: string | null = null): void => {
    setPendingRemoteModelId(modelId)
    setRemoteUrlDraft(remoteUrl ?? '')
    setRemoteDialogOpen(true)
  }

  const saveRemoteEndpoint = async (): Promise<void> => {
    setRemotePending(true)
    try {
      const saved = await window.api.speech.saveRemoteEndpoint(remoteUrlDraft)
      setRemoteUrl(saved.url)
      await refreshModelStates()
      const health = await window.api.speech.checkRemoteEndpoint()
      if (pendingRemoteModelId) {
        updateVoiceSettings({ sttModel: pendingRemoteModelId })
      }
      setRemoteDialogOpen(false)
      setPendingRemoteModelId(null)
      if (health.ok) {
        toast.success(
          translate('settings.voice.remoteEndpoint.savedReachable', 'Remote speech server saved')
        )
      } else {
        toast.warning(
          translate(
            'settings.voice.remoteEndpoint.savedUnreachable',
            'Saved, but the server did not answer /health'
          ),
          { description: health.error }
        )
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : translate(
              'settings.voice.remoteEndpoint.saveFailed',
              'Failed to save remote speech server'
            )
      )
    } finally {
      if (mountedRef.current) {
        setRemotePending(false)
      }
    }
  }

  const clearRemoteEndpoint = async (): Promise<void> => {
    setRemotePending(true)
    try {
      await window.api.speech.clearRemoteEndpoint()
      setRemoteUrl(null)
      updateVoiceSettings({
        sttModel: selectedModel?.provider === 'remote' ? '' : voiceSettings.sttModel
      })
      await refreshModelStates()
      setRemoteDialogOpen(false)
      setPendingRemoteModelId(null)
    } catch {
      toast.error(
        translate(
          'settings.voice.remoteEndpoint.clearFailed',
          'Failed to remove remote speech server'
        )
      )
    } finally {
      if (mountedRef.current) {
        setRemotePending(false)
      }
    }
  }

  const clearOpenAiApiKey = async (): Promise<void> => {
    setOpenAiKeyPending(true)
    try {
      await window.api.speech.clearOpenAiApiKey()
      updateVoiceSettings({
        openAiApiKeyConfigured: false,
        sttModel: selectedModel?.provider === 'openai' ? '' : voiceSettings.sttModel
      })
      await refreshModelStates()
      setOpenAiDialogOpen(false)
      setOpenAiApiKeyDraft('')
      setPendingCloudModelId(null)
      toast.success(
        translate('auto.components.settings.VoicePane.37aba8bb63', 'OpenAI API key cleared')
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translate(
              'auto.components.settings.VoicePane.62d2a84d31',
              'Failed to clear OpenAI API key'
            )
      )
    } finally {
      if (mountedRef.current) {
        setOpenAiKeyPending(false)
      }
    }
  }

  return (
    <div ref={handlePaneRef} className="space-y-1">
      <VoiceDictationSettingsSection
        voiceSettings={voiceSettings}
        permissionPending={permissionPending}
        onToggleVoiceDictation={() => void toggleVoiceDictation()}
        onUpdateVoiceSettings={updateVoiceSettings}
      />

      <VoiceSpeechModelSection
        voiceSettings={voiceSettings}
        catalog={catalog}
        modelStates={modelStates}
        onUpdateVoiceSettings={updateVoiceSettings}
        onOpenOpenAiDialog={openOpenAiDialog}
        onOpenRemoteDialog={openRemoteDialog}
        onRefreshModelStates={refreshModelStates}
      />

      {showOpenAiSettingsRow && (
        <>
          <Separator />
          <UnsealedCredentialNotice
            protection={openAiKeyProtection}
            credentialName={translate(
              'auto.components.settings.VoicePane.openAiKeyName',
              'Your OpenAI transcription key'
            )}
          />
          <OpenAiTranscriptionSettingsRow
            configured={voiceSettings.openAiApiKeyConfigured}
            disabled={openAiKeyPending}
            onConfigure={() => openOpenAiDialog(null)}
            onClear={() => void clearOpenAiApiKey()}
          />
        </>
      )}

      {(remoteUrl || selectedModel?.provider === 'remote') && (
        <>
          <Separator />
          <RemoteSttEndpointSettingsRow
            url={remoteUrl}
            disabled={remotePending}
            onConfigure={() => openRemoteDialog(null)}
            onClear={() => void clearRemoteEndpoint()}
          />
        </>
      )}

      <RemoteSttEndpointDialog
        open={remoteDialogOpen}
        configured={remoteUrl !== null}
        urlDraft={remoteUrlDraft}
        pending={remotePending}
        onOpenChange={setRemoteDialogOpen}
        onUrlDraftChange={setRemoteUrlDraft}
        onSave={() => void saveRemoteEndpoint()}
        onClear={() => void clearRemoteEndpoint()}
      />

      <OpenAiTranscriptionKeyDialog
        open={openAiDialogOpen}
        configured={voiceSettings.openAiApiKeyConfigured}
        apiKeyDraft={openAiApiKeyDraft}
        pending={openAiKeyPending}
        onOpenChange={setOpenAiDialogOpen}
        onApiKeyDraftChange={setOpenAiApiKeyDraft}
        onSave={() => void saveOpenAiApiKey()}
        onClear={() => void clearOpenAiApiKey()}
      />
    </div>
  )
}
