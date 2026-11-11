import { isOfferedSpeechModel } from '../../shared/speech-model-retirement'
import { getCatalogModel } from './model-catalog'

// Why: headless hubs have no desktop UI and one global model; any paired phone could otherwise
// switch every client's dictation (to on-host CPU models or to a third-party cloud). The hub admin
// pins it with this variable (a systemd drop-in); unset or empty keeps the settings-driven model.
export const SPEECH_MODEL_PIN_ENV = 'ORCA_SPEECH_MODEL'

export const SPEECH_MODEL_PINNED_ERROR = 'voice_model_pinned'
export const SPEECH_MODEL_PIN_INVALID_ERROR = 'voice_model_pin_invalid'

export type SpeechModelPin =
  | { kind: 'none' }
  | { kind: 'pinned'; id: string }
  | { kind: 'invalid'; id: string }

const warnedInvalidPins = new Set<string>()

/** Reads the environment on every call; nothing is cached. */
export function pinnedSpeechModelId(env: NodeJS.ProcessEnv = process.env): SpeechModelPin {
  const id = env[SPEECH_MODEL_PIN_ENV]?.trim()
  if (!id) {
    return { kind: 'none' }
  }
  const manifest = getCatalogModel(id)
  if (manifest && isOfferedSpeechModel(manifest)) {
    return { kind: 'pinned', id }
  }
  if (!warnedInvalidPins.has(id)) {
    warnedInvalidPins.add(id)
    console.warn(
      `[speech] ${SPEECH_MODEL_PIN_ENV}=${id} is not an offered speech model; dictation is refused until it is fixed.`
    )
  }
  return { kind: 'invalid', id }
}

/**
 * The model a dictation start must use: the pin when one is set, otherwise the requested one.
 * Throws when the pin is invalid or the request names another model.
 */
export function resolveDictationModelId(
  requested: string | undefined,
  pin: SpeechModelPin = pinnedSpeechModelId()
): string | undefined {
  if (pin.kind === 'none') {
    return requested
  }
  if (pin.kind === 'invalid') {
    throw new Error(SPEECH_MODEL_PIN_INVALID_ERROR)
  }
  if (requested && requested !== pin.id) {
    throw new Error(SPEECH_MODEL_PINNED_ERROR)
  }
  return pin.id
}
