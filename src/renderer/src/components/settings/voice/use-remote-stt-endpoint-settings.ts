import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import type { VoiceSettings } from '../../../../../shared/speech-types'
import { DEFAULT_REMOTE_STT_URL } from './remote-stt-default-url'

type RemoteSttEndpointSettingsOptions = {
  selectedModelId: string
  refreshModelStates: () => Promise<void>
  updateVoiceSettings: (updates: Partial<VoiceSettings>) => void
  isMounted: () => boolean
}

export function useRemoteSttEndpointSettings({
  selectedModelId,
  refreshModelStates,
  updateVoiceSettings,
  isMounted
}: RemoteSttEndpointSettingsOptions) {
  const t = useTranslate()
  const [url, setUrl] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [pendingModelId, setPendingModelId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.speech
      .getRemoteEndpoint()
      .then((endpoint) => {
        if (!cancelled) {
          setUrl(endpoint.url)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const openSetup = (modelId: string | null): void => {
    setPendingModelId(modelId)
    setUrlDraft(url ?? DEFAULT_REMOTE_STT_URL)
    setDialogOpen(true)
  }

  const save = async (): Promise<void> => {
    setPending(true)
    try {
      const saved = await window.api.speech.saveRemoteEndpoint(urlDraft)
      setUrl(saved.url)
      await refreshModelStates()
      const health = await window.api.speech.checkRemoteEndpoint()
      if (pendingModelId) {
        updateVoiceSettings({ sttModel: pendingModelId })
      }
      setDialogOpen(false)
      setPendingModelId(null)
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
    } catch (error) {
      toast.error(
        readIpcErrorMessage(error) ??
          t('settings.voice.remoteEndpoint.saveFailed', 'Failed to save remote speech server')
      )
    } finally {
      if (isMounted()) {
        setPending(false)
      }
    }
  }

  const clear = async (): Promise<void> => {
    setPending(true)
    try {
      await window.api.speech.clearRemoteEndpoint()
      setUrl(null)
      if (selectedModelId === 'remote-parakeet-tdt-0.6b-v3') {
        updateVoiceSettings({ sttModel: '' })
      }
      await refreshModelStates()
      setDialogOpen(false)
      setPendingModelId(null)
    } catch (error) {
      toast.error(
        readIpcErrorMessage(error) ??
          t('settings.voice.remoteEndpoint.clearFailed', 'Failed to remove remote speech server')
      )
    } finally {
      if (isMounted()) {
        setPending(false)
      }
    }
  }

  return { url, dialogOpen, setDialogOpen, urlDraft, setUrlDraft, pending, openSetup, save, clear }
}
