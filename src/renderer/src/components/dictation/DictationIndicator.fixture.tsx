import { useMemo, useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { DictationIndicator } from './DictationIndicator'
import { publishDictationMeter, resetDictationMeter } from './dictation-meter-store'
import type { DictationFailureKind } from './dictation-toasts'
import type { SpeechModelUpdateTarget } from './speech-model-update-target'
import type {
  SpeechModelManifest,
  SpeechModelState,
  SpeechSegmentProgressEvent
} from '../../../../shared/speech-types'
import type { DictationQueuedSendKind } from './use-dictation-queued-send'

function PaneWithPill({
  captureLive = true,
  sessionId = null,
  failure = null,
  queued = null,
  setup = null
}: {
  captureLive?: boolean
  sessionId?: string | null
  failure?: DictationFailureKind | null
  queued?: DictationQueuedSendKind | null
  setup?: SpeechModelUpdateTarget | null
}) {
  const [pane, setPane] = useState<HTMLElement | null>(null)
  const anchor = useMemo(
    () => (pane ? { element: pane, placement: 'over' as const } : null),
    [pane]
  )
  return (
    <div ref={setPane} className="relative h-28 w-full bg-background">
      {anchor ? (
        <DictationIndicator
          sessionId={sessionId}
          captureLive={captureLive}
          anchor={anchor}
          failure={failure}
          queued={queued}
          setup={setup}
          onSetupClose={() => {}}
        />
      ) : null}
    </div>
  )
}

export const listening = defineFixture({
  width: 520,
  store: { dictationState: 'listening' },
  setup: () => publishDictationMeter({ level: 0.5, isSpeaking: true, isClipping: false }),
  render: () => <PaneWithPill />
})

let emitSegmentProgress: ((event: SpeechSegmentProgressEvent) => void) | null = null
let restoreSegmentProgress: (() => void) | null = null

function setupSegmentProgress(): void {
  const original = window.api.speech.onSegmentProgress
  window.api.speech.onSegmentProgress = (callback) => {
    emitSegmentProgress = callback
    return () => {
      emitSegmentProgress = null
    }
  }
  restoreSegmentProgress = () => {
    window.api.speech.onSegmentProgress = original
  }
}

async function showSegmentProgress(silenceMs: number, segmentMs: number): Promise<void> {
  emitSegmentProgress?.({
    sessionId: 'fixture',
    silenceMs,
    pauseMs: 1_200,
    segmentMs,
    maxMs: 30_000,
    limitWarningMs: 3_000
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  restoreSegmentProgress?.()
}

export const remoteProgressSequence = defineFixture({
  width: 520,
  store: { dictationState: 'listening' },
  setup: setupSegmentProgress,
  render: () => <PaneWithPill sessionId="fixture" />,
  interact: async (frame) => {
    const button = frame.querySelector<HTMLButtonElement>('[data-size="icon-xs-round"]')
    if (!button) {
      throw new Error('Missing finish button')
    }
    const checkCue = (colored: boolean, label: string, blinking = false) => {
      if (
        Boolean(button.style.backgroundColor) !== colored ||
        !button.getAttribute('aria-label')?.includes(label) ||
        button.getAnimations().some((animation) => !(animation instanceof CSSTransition)) !==
          blinking
      ) {
        throw new Error(`Unexpected finish button cue at ${label}`)
      }
    }
    const progress = async (
      silenceMs: number,
      segmentMs: number,
      cutReason?: 'pause' | 'limit'
    ) => {
      emitSegmentProgress?.({
        sessionId: 'fixture',
        silenceMs,
        pauseMs: 1_200,
        segmentMs,
        maxMs: 30_000,
        limitWarningMs: 3_000,
        cutReason
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await progress(0, 4_000)
    checkCue(false, 'Finish')
    await progress(600, 6_000)
    checkCue(true, 'Pause cut approaching')
    await progress(0, 6_040)
    checkCue(false, 'Finish')
    await progress(0, 28_500)
    checkCue(true, 'Forced cut approaching')
    await progress(40, 28_540)
    checkCue(true, 'Forced cut approaching')
    await progress(0, 0, 'pause')
    checkCue(false, 'Finish', true)
    await new Promise((resolve) => setTimeout(resolve, 550))
    checkCue(false, 'Finish')
    await progress(0, 0, 'limit')
    checkCue(false, 'Finish', true)
    await new Promise((resolve) => setTimeout(resolve, 550))
    checkCue(false, 'Finish')
    restoreSegmentProgress?.()
  }
})

export const remotePauseProgress = defineFixture({
  width: 520,
  store: { dictationState: 'listening' },
  setup: setupSegmentProgress,
  render: () => <PaneWithPill sessionId="fixture" />,
  interact: () => showSegmentProgress(600, 6_000)
})

export const remoteMaxProgress = defineFixture({
  width: 520,
  store: { dictationState: 'listening' },
  setup: setupSegmentProgress,
  render: () => <PaneWithPill sessionId="fixture" />,
  interact: () => showSegmentProgress(0, 28_500)
})

export const startingBeforeMic = defineFixture({
  width: 520,
  store: { dictationState: 'starting' },
  setup: resetDictationMeter,
  render: () => <PaneWithPill captureLive={false} />
})

export const liveText = defineFixture({
  width: 520,
  store: {
    dictationState: 'listening',
    liveText: {
      committed: 'It should go back to the page you came from.',
      tentative: 'Check where returnTo gets dropped',
      speechPending: false
    }
  },
  setup: () => publishDictationMeter({ level: 0.6, isSpeaking: true, isClipping: false }),
  render: () => <PaneWithPill />
})

export const committedText = defineFixture({
  width: 520,
  store: {
    dictationState: 'listening',
    liveText: {
      committed: 'It should go back to the page you came from. Check where returnTo gets dropped.',
      tentative: '',
      speechPending: false
    }
  },
  setup: () => publishDictationMeter({ level: 0.2, isSpeaking: false, isClipping: false }),
  render: () => <PaneWithPill />
})

export const pendingSpeech = defineFixture({
  width: 520,
  store: {
    dictationState: 'listening',
    liveText: {
      committed: 'It should go back to the page you came from.',
      tentative: '',
      speechPending: true
    }
  },
  setup: () => publishDictationMeter({ level: 0.6, isSpeaking: true, isClipping: false }),
  render: () => <PaneWithPill />
})

export const pendingFirstWords = defineFixture({
  width: 520,
  store: {
    dictationState: 'listening',
    liveText: { committed: '', tentative: '', speechPending: true }
  },
  setup: () => publishDictationMeter({ level: 0.6, isSpeaking: true, isClipping: false }),
  render: () => <PaneWithPill />
})

export const tooLoud = defineFixture({
  width: 520,
  store: { dictationState: 'listening' },
  setup: () => publishDictationMeter({ level: 1, isSpeaking: true, isClipping: true }),
  render: () => <PaneWithPill />
})

export const finishing = defineFixture({
  width: 520,
  store: { dictationState: 'stopping' },
  setup: resetDictationMeter,
  render: () => <PaneWithPill />
})

export const transcribeFailed = defineFixture({
  width: 520,
  store: { dictationState: 'error' },
  render: () => <PaneWithPill failure="transcribe" />
})

export const modelFailed = defineFixture({
  width: 520,
  store: { dictationState: 'error' },
  render: () => <PaneWithPill failure="settings" />
})

export const queuedChatSend = defineFixture({
  width: 520,
  store: { dictationState: 'stopping' },
  setup: resetDictationMeter,
  render: () => <PaneWithPill queued="chat" />
})

export const queuedTerminalEnter = defineFixture({
  width: 520,
  store: { dictationState: 'stopping' },
  setup: resetDictationMeter,
  render: () => <PaneWithPill queued="terminal" />
})

function speechModel(id: string, label: string): SpeechModelManifest {
  return {
    id,
    label,
    type: 'transducer',
    provider: 'local',
    language: 'en',
    languages: ['en'],
    sampleRate: 16000,
    streaming: false,
    sizeBytes: 740_000_000
  }
}

const parakeet = speechModel('parakeet', 'Parakeet')
const updateTarget: SpeechModelUpdateTarget = { model: parakeet }
const retiredTarget: SpeechModelUpdateTarget = {
  model: parakeet,
  retired: speechModel('zipformer', 'Zipformer')
}

function mockSpeechDownloads(downloadModel: () => Promise<void> = () => new Promise(() => {})) {
  Object.assign(window.api.speech, {
    onDownloadProgress: () => () => {},
    getModelStates: async () => [],
    downloadModel
  })
}

function withParakeet(state: Omit<SpeechModelState, 'id'>) {
  return { modelStates: [{ id: 'parakeet', ...state }] }
}

export const setupNotice = defineFixture({
  width: 520,
  store: withParakeet({ status: 'not-downloaded', needsUpdate: true }),
  setup: () => mockSpeechDownloads(),
  render: () => <PaneWithPill setup={updateTarget} />
})

export const setupRetiredNotice = defineFixture({
  width: 520,
  store: withParakeet({ status: 'not-downloaded' }),
  setup: () => mockSpeechDownloads(),
  render: () => <PaneWithPill setup={retiredTarget} />
})

export const setupDownloading = defineFixture({
  width: 520,
  store: withParakeet({ status: 'downloading', progress: 0.42 }),
  setup: () => mockSpeechDownloads(),
  render: () => <PaneWithPill setup={updateTarget} />
})

export const setupDone = defineFixture({
  width: 520,
  store: withParakeet({ status: 'ready' }),
  setup: () => mockSpeechDownloads(),
  render: () => <PaneWithPill setup={updateTarget} />
})

export const setupDoneRetired = defineFixture({
  width: 520,
  store: withParakeet({ status: 'ready' }),
  setup: () => mockSpeechDownloads(),
  render: () => <PaneWithPill setup={retiredTarget} />
})

export const setupFailed = defineFixture({
  width: 520,
  store: withParakeet({ status: 'not-downloaded', needsUpdate: true }),
  setup: () => mockSpeechDownloads(() => Promise.reject(new Error('network'))),
  render: () => <PaneWithPill setup={updateTarget} />,
  interact: async (frame) => {
    frame.querySelector<HTMLButtonElement>('[data-testid="dictation-setup-pill"] button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
})
