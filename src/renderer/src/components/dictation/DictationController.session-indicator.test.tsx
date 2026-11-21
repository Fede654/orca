// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  controls: null as null | { start: () => void; cancel: () => void },
  events: null as null | { onStopped: (id: string) => void },
  state: {
    dictationState: 'idle',
    setDictationState: () => {},
    setLiveText: () => {},
    recordFeatureInteraction: () => {},
    keybindings: [],
    settings: { voice: { enabled: true, sttModel: 'remote-parakeet-tdt-0.6b-v3' } }
  }
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) => select(harness.state)
}))
vi.mock('./DictationIndicator', () => ({
  DictationIndicator: ({ sessionId }: { sessionId: string | null }) =>
    createElement('output', null, sessionId ?? 'none')
}))
vi.mock('./use-audio-capture', () => ({
  useAudioCapture: () => ({
    start: () => new Promise(() => {}),
    stop: () => {},
    finish: async () => {},
    flushBufferedAudio: () => {},
    discardBufferedAudio: () => {},
    getCapturedChunkCount: () => 0,
    getLastSpeechAt: () => 0
  })
}))
vi.mock('./use-dictation-controls', () => ({
  useDictationControls: (_voice: unknown, _state: unknown, controls: typeof harness.controls) => {
    harness.controls = controls
  }
}))
vi.mock('./use-dictation-speech-events', () => ({
  useDictationSpeechEvents: (events: typeof harness.events) => {
    harness.events = events
  }
}))
vi.mock('./use-dictation-speech-model-setup', () => ({
  useDictationSpeechModelSetup: () => ({
    readyToRecord: async () => true,
    hasPendingStart: () => false,
    invalidatePendingStart: () => {},
    closeSetup: () => {},
    setupTarget: null
  })
}))
vi.mock('./use-dictation-queued-send', () => ({
  useDictationQueuedSend: () => ({
    clear: () => {},
    release: () => {},
    queueTerminalEnter: () => {},
    queuedKind: null
  })
}))
vi.mock('./use-dictation-cleanup', () => ({
  useDictationCleanup: () => ({ land: () => {}, interrupt: () => false }),
  shouldHoldForCleanup: () => false
}))
vi.mock('./use-dictation-retry', () => ({ useDictationRetry: () => () => {} }))
vi.mock('./use-hold-dictation-gesture', () => ({
  useHoldDictationGesture: () => ({ isHolding: false })
}))
vi.mock('./use-dictation-silence-stop', () => ({ useDictationSilenceStop: () => {} }))
vi.mock('./dictation-insertion-target', () => ({ captureInsertionTarget: () => null }))
vi.mock('./dictation-context', () => ({ captureDictationContext: () => ({}) }))
vi.mock('./dictation-pill-anchor', () => ({ dictationPillAnchorFor: () => null }))
vi.mock('./dictation-transcript-delivery', () => ({
  createDictationTranscriptDelivery: () => () => {}
}))
vi.mock('./dictation-kept-recording', () => ({
  canRetryDictation: () => false,
  createDictationKeptRecording: () => ({ keep: () => {} })
}))
vi.mock('@/store/slices/dictation/dictation', () => ({ NO_DICTATION_LIVE_TEXT: {} }))

import { DictationController } from './DictationController'

it('updates the indicator session on start, cancellation and a replacement recording', async () => {
  vi.stubGlobal('api', {})
  const previousApi = window.api
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { speech: { cancelDictation: async () => {} } }
  })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(createElement(DictationController))
    })
    expect(host.textContent).toBe('none')
    await act(async () => {
      harness.controls!.start()
    })
    expect(host.textContent).toBe('1')
    harness.events!.onStopped('1')
    await act(async () => {
      harness.controls!.cancel()
    })
    expect(host.textContent).toBe('none')
    await act(async () => {
      harness.controls!.start()
    })
    expect(host.textContent).toBe('3')
    harness.events!.onStopped('3')
    await act(async () => {
      harness.controls!.cancel()
    })
    expect(host.textContent).toBe('none')
  } finally {
    await act(async () => {
      root.unmount()
    })
    Object.defineProperty(window, 'api', { configurable: true, value: previousApi })
    vi.unstubAllGlobals()
  }
})
