import { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { SpeechSilenceProgressEvent } from '../../../../shared/speech-types'

export function DictationSilenceProgress({ sessionId }: { sessionId: string | null }) {
  const t = useTranslate()
  const [progress, setProgress] = useState<SpeechSilenceProgressEvent | null>(null)

  useEffect(() => {
    if (!sessionId) {
      return
    }
    return window.api.speech.onSilenceProgress((event) => {
      if (event.sessionId === sessionId) {
        setProgress(event)
      }
    })
  }, [sessionId])

  if (!progress || progress.sessionId !== sessionId) {
    return null
  }

  const percent = Math.min(100, (progress.silenceMs / progress.pauseMs) * 100)
  return (
    <span
      role="progressbar"
      aria-label={t('auto.components.dictation.DictationSilenceProgress.pause', 'Pause before cut')}
      aria-valuemin={0}
      aria-valuemax={progress.pauseMs}
      aria-valuenow={progress.silenceMs}
      className="size-2.5 shrink-0 rounded-full"
      style={{
        backgroundColor: `color-mix(in srgb, var(--status-warning) ${percent}%, var(--status-success))`
      }}
    />
  )
}
