import { DEFAULT_REMOTE_STT_URL } from './remote-stt-default-url'
import { useState, type RefObject } from 'react'
import { toast } from 'sonner'
import type { VoiceSettings } from '../../../../../shared/speech/speech-types'
import { useTranslate } from '@/i18n/use-translate'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'

async function runRemoteEndpointUpdate(
  perform: () => Promise<void>,
  onError: (error: unknown) => void,
  setPending: (pending: boolean) => void,
  mountedRef: RefObject<boolean>
): Promise<void> {
  setPending(true)
  try {
    await perform()
  } catch (error) {
    onError(error)
  } finally {
    if (mountedRef.current) {
      setPending(false)
    }
  }
}

export function useRemoteSttEndpoint({
  selectedModelId,
  updateVoiceSettings,
  refreshModelStates,
  mountedRef
}: {
  selectedModelId: string | undefined
  updateVoiceSettings: (updates: Partial<VoiceSettings>) => void
  refreshModelStates: () => Promise<void>
  mountedRef: RefObject<boolean>
}) {
  const t = useTranslate()
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false)
  const [remoteUrlDraft, setRemoteUrlDraft] = useState('')
  const [remotePending, setRemotePending] = useState(false)
  const [pendingRemoteModelId, setPendingRemoteModelId] = useState<string | null>(null)
  const openRemoteDialog = (modelId: string | null): void => {
    setPendingRemoteModelId(modelId)
    setRemoteUrlDraft(remoteUrl ?? DEFAULT_REMOTE_STT_URL)
    setRemoteDialogOpen(true)
  }

  const saveRemoteEndpoint = (): Promise<void> =>
    runRemoteEndpointUpdate(
      async () => {
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
            t('settings.voice.remoteEndpoint.savedReachable', 'Remote speech server saved')
          )
        } else {
          toast.warning(
            t(
              'settings.voice.remoteEndpoint.savedUnreachable',
              'Saved, but the server did not answer /health'
            ),
            { description: health.error }
          )
        }
      },
      (error) => {
        toast.error(
          readIpcErrorMessage(error) ??
            t('settings.voice.remoteEndpoint.saveFailed', 'Failed to save remote speech server')
        )
      },
      setRemotePending,
      mountedRef
    )

  const clearRemoteEndpoint = (): Promise<void> =>
    runRemoteEndpointUpdate(
      async () => {
        await window.api.speech.clearRemoteEndpoint()
        setRemoteUrl(null)
        if (selectedModelId === 'remote-parakeet-tdt-0.6b-v3') {
          updateVoiceSettings({ sttModel: '' })
        }
        await refreshModelStates()
        setRemoteDialogOpen(false)
        setPendingRemoteModelId(null)
      },
      (error) => {
        toast.error(
          readIpcErrorMessage(error) ??
            t('settings.voice.remoteEndpoint.clearFailed', 'Failed to remove remote speech server')
        )
      },
      setRemotePending,
      mountedRef
    )

  return {
    remoteUrl,
    setRemoteUrl,
    remoteDialogOpen,
    setRemoteDialogOpen,
    remoteUrlDraft,
    setRemoteUrlDraft,
    remotePending,
    openRemoteDialog,
    saveRemoteEndpoint,
    clearRemoteEndpoint
  }
}
