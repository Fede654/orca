import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REMOTE_STT_ENDPOINT_FILE = 'remote-stt-endpoint.json'
const REMOTE_STT_URL_MAX_LENGTH = 2048
const REMOTE_STT_HEALTH_TIMEOUT_MS = 3000

export const REMOTE_TRANSCRIPTION_MODEL_BY_ID: Record<string, string> = {
  'remote-parakeet-tdt-0.6b-v3': 'parakeet-tdt-0.6b-v3'
}

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

export function getRemoteSttEndpointPath(): string {
  return join(getOrcaDir(), REMOTE_STT_ENDPOINT_FILE)
}

/** Accepts `host:port`, `http://host:port` or `http://host:port/v1`; returns the server root. */
export function normalizeRemoteSttBaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > REMOTE_STT_URL_MAX_LENGTH) {
    throw new Error('Remote speech server URL is required')
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('Remote speech server URL is not valid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Remote speech server URL must use http or https')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Remote speech server URL must not embed credentials')
  }
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${parsed.origin}${path}`
}

export function getRemoteTranscriptionUrl(baseUrl: string): string {
  return `${baseUrl}/v1/audio/transcriptions`
}

export function readRemoteSttBaseUrl(): string | null {
  const path = getRemoteSttEndpointPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const url = parsed && typeof parsed === 'object' && 'url' in parsed ? parsed.url : null
    return typeof url === 'string' ? normalizeRemoteSttBaseUrl(url) : null
  } catch {
    return null
  }
}

export function hasRemoteSttEndpoint(): boolean {
  return readRemoteSttBaseUrl() !== null
}

export function saveRemoteSttEndpoint(input: string): string {
  const url = normalizeRemoteSttBaseUrl(input)
  mkdirSync(getOrcaDir(), { recursive: true })
  writeFileSync(getRemoteSttEndpointPath(), JSON.stringify({ url }), { mode: 0o600 })
  return url
}

export function clearRemoteSttEndpoint(): void {
  rmSync(getRemoteSttEndpointPath(), { force: true })
}

export async function checkRemoteSttHealth(
  baseUrl: string,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; error: string }> {
  const timeout = AbortSignal.timeout(REMOTE_STT_HEALTH_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return {
      ok: false,
      error: timeout.aborted
        ? 'timed out'
        : error instanceof Error
          ? error.message
          : 'request failed'
    }
  }
}
