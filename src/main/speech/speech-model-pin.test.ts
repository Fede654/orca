import { afterEach, describe, expect, it, vi } from 'vitest'
import { SPEECH_MODEL_CATALOG } from './model-catalog'
import {
  pinnedSpeechModelId,
  resolveDictationModelId,
  SPEECH_MODEL_PIN_ENV,
  SPEECH_MODEL_PIN_INVALID_ERROR,
  SPEECH_MODEL_PINNED_ERROR
} from './speech-model-pin'

const OFFERED = 'remote-parakeet-tdt-0.6b-v3'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('pinnedSpeechModelId', () => {
  it('keeps the settings-driven model when the variable is unset, empty or blank', () => {
    expect(pinnedSpeechModelId({})).toEqual({ kind: 'none' })
    expect(pinnedSpeechModelId({ [SPEECH_MODEL_PIN_ENV]: '' })).toEqual({ kind: 'none' })
    expect(pinnedSpeechModelId({ [SPEECH_MODEL_PIN_ENV]: '  ' })).toEqual({ kind: 'none' })
  })

  it('pins an offered catalog model', () => {
    expect(pinnedSpeechModelId({ [SPEECH_MODEL_PIN_ENV]: ` ${OFFERED} ` })).toEqual({
      kind: 'pinned',
      id: OFFERED
    })
  })

  it('reports an unknown or retired id as invalid and warns once per id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const env = { [SPEECH_MODEL_PIN_ENV]: 'no-such-model-for-pin-test' }
    expect(pinnedSpeechModelId(env)).toEqual({ kind: 'invalid', id: 'no-such-model-for-pin-test' })
    expect(pinnedSpeechModelId(env)).toEqual({ kind: 'invalid', id: 'no-such-model-for-pin-test' })
    expect(warn).toHaveBeenCalledTimes(1)
    const retiredId = SPEECH_MODEL_CATALOG.find((model) => model.replacedBy)?.id ?? ''
    expect(retiredId).not.toBe('')
    expect(pinnedSpeechModelId({ [SPEECH_MODEL_PIN_ENV]: retiredId })).toEqual({
      kind: 'invalid',
      id: retiredId
    })
  })

  it('reads process.env at call time', () => {
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, OFFERED)
    expect(pinnedSpeechModelId()).toEqual({ kind: 'pinned', id: OFFERED })
    vi.stubEnv(SPEECH_MODEL_PIN_ENV, '')
    expect(pinnedSpeechModelId()).toEqual({ kind: 'none' })
  })
})

describe('resolveDictationModelId', () => {
  it('passes the request through without a pin', () => {
    expect(resolveDictationModelId('any', { kind: 'none' })).toBe('any')
    expect(resolveDictationModelId(undefined, { kind: 'none' })).toBeUndefined()
  })

  it('uses the pin when the request is absent or names it, and refuses another model', () => {
    const pin = { kind: 'pinned', id: OFFERED } as const
    expect(resolveDictationModelId(undefined, pin)).toBe(OFFERED)
    expect(resolveDictationModelId('', pin)).toBe(OFFERED)
    expect(resolveDictationModelId(OFFERED, pin)).toBe(OFFERED)
    expect(() => resolveDictationModelId('other', pin)).toThrow(SPEECH_MODEL_PINNED_ERROR)
  })

  it('fails closed on an invalid pin', () => {
    expect(() => resolveDictationModelId(OFFERED, { kind: 'invalid', id: 'x' })).toThrow(
      SPEECH_MODEL_PIN_INVALID_ERROR
    )
  })
})
