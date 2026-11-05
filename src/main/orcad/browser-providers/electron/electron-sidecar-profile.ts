import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { isSafeOwnedDirectory } from '../../../../shared/owned-private-directory'
import { isProcessAlive } from '../../../../shared/serve-bundle-coordination'
import { removeTree } from '../../../../shared/windows-transient-lock-removal'
import { isDirectChild } from '../../../filesystem/owned-temp-staging-root'
import {
  clearRuntimeMetadata,
  readRuntimeMetadataAsync
} from '../../../runtime/rpc/server/runtime-metadata'
import { sendOrcadSidecarRequest } from '../orcad-sidecar-runtime-client'

const STOP_TIMEOUT_MS = 5_000
const ORPHAN_PROBE_TIMEOUT_MS = 2_000
const PROFILE_PREFIX = 'orcad-browser-'
// Lives in orcad's private data root, so only this instance can name a profile for removal.
const PROFILE_RECORD_FILE = 'browser-sidecar-profile.json'
const ProfileRecord = z.object({ profilePath: z.string() })
export const PERSISTENT_PROFILE_ENV = 'ORCA_BROWSER_PROFILE_DIR'
// The sidecar binds o-<pid>-<id>.sock (up to 19 bytes) in its profile; sun_path is 104-108 bytes.
const MAX_PERSISTENT_PROFILE_PATH_BYTES = 80

export type ElectronSidecarProfile = {
  path: string
  /** Opt-in profiles outlive the sidecar; everything else is removed when it stops. */
  persistent: boolean
}

// Short /tmp, not macOS's long tmpdir(): the sidecar binds its runtime socket in its profile.
function temporaryRoot(): string {
  return process.platform === 'win32' ? tmpdir() : '/tmp'
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // The sidecar already exited.
  }
}

export async function stopElectronSidecar(pid: number): Promise<void> {
  signalProcess(pid, 'SIGTERM')
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await delay(50)
  }
  if (isProcessAlive(pid)) {
    signalProcess(pid, 'SIGKILL')
  }
}

/** The opt-in persistent profile directory, or null when the sidecar should use a throwaway one. */
export function persistentElectronSidecarProfileDir(
  environment: NodeJS.ProcessEnv = process.env
): string | null {
  const configured = environment[PERSISTENT_PROFILE_ENV]?.trim()
  if (!configured) {
    return null
  }
  if (!isAbsolute(configured)) {
    throw new Error(`${PERSISTENT_PROFILE_ENV} must be an absolute path, got: ${configured}`)
  }
  const profilePath = resolve(configured)
  if (
    process.platform !== 'win32' &&
    Buffer.byteLength(profilePath) > MAX_PERSISTENT_PROFILE_PATH_BYTES
  ) {
    throw new Error(
      `${PERSISTENT_PROFILE_ENV} must be at most ${MAX_PERSISTENT_PROFILE_PATH_BYTES} bytes so the sidecar socket fits in it: ${profilePath}`
    )
  }
  return profilePath
}

/** Reuse a configured profile across starts, so a headless server keeps its browser sign-ins. */
async function preparePersistentProfile(profilePath: string): Promise<void> {
  await mkdir(profilePath, { recursive: true, mode: 0o700 })
  if (!isSafeOwnedDirectory(await lstat(profilePath))) {
    throw new Error(
      `${PERSISTENT_PROFILE_ENV} must be a directory owned by this user with mode 0700, not a symlink: ${profilePath}`
    )
  }
  // A crashed orcad can leave its sidecar running on this profile, which Chromium locks.
  await stopOrphanedSidecar(profilePath)
  // Stale discovery would point readiness polling at the previous sidecar.
  clearRuntimeMetadata(profilePath)
}

/** Unpredictable per start, so no other account can claim the name first. */
export async function createElectronSidecarProfile(
  orcadUserDataPath: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<ElectronSidecarProfile> {
  const persistentPath = persistentElectronSidecarProfileDir(environment)
  if (persistentPath) {
    // Not recorded for leftover removal: only throwaway profiles are ever deleted.
    await preparePersistentProfile(persistentPath)
    return { path: persistentPath, persistent: true }
  }
  const profilePath = await mkdtemp(join(temporaryRoot(), PROFILE_PREFIX))
  try {
    await writeFile(join(orcadUserDataPath, PROFILE_RECORD_FILE), JSON.stringify({ profilePath }), {
      mode: 0o600
    })
  } catch (error) {
    await removeTree(profilePath).catch(() => undefined)
    throw error
  }
  return { path: profilePath, persistent: false }
}

async function readRecordedProfile(orcadUserDataPath: string): Promise<string | null> {
  try {
    const raw = await readFile(join(orcadUserDataPath, PROFILE_RECORD_FILE), 'utf8')
    const { profilePath } = ProfileRecord.parse(JSON.parse(raw))
    return isDirectChild(temporaryRoot(), profilePath) &&
      basename(profilePath).startsWith(PROFILE_PREFIX)
      ? profilePath
      : null
  } catch {
    return null
  }
}

async function stopOrphanedSidecar(profilePath: string): Promise<void> {
  const orphan = await readRuntimeMetadataAsync(profilePath).catch(() => null)
  if (!orphan || !isProcessAlive(orphan.pid)) {
    return
  }
  // Answering with its own auth token proves the pid is still that sidecar, not a recycled one.
  const answered = await sendOrcadSidecarRequest(
    orphan,
    'status.get',
    undefined,
    ORPHAN_PROBE_TIMEOUT_MS
  ).then(
    () => true,
    () => false
  )
  if (answered) {
    await stopElectronSidecar(orphan.pid)
  }
}

/** Remove the profile, and any sidecar still on it, that a crashed or killed orcad left behind. */
export async function removeLeftoverElectronSidecarProfile(
  orcadUserDataPath: string
): Promise<void> {
  const profilePath = await readRecordedProfile(orcadUserDataPath)
  const stats = profilePath ? await lstat(profilePath).catch(() => null) : null
  if (!profilePath || !stats || !isSafeOwnedDirectory(stats)) {
    return
  }
  await stopOrphanedSidecar(profilePath)
  await removeTree(profilePath).catch((error: unknown) =>
    console.warn('[orcad] Leftover Electron browser sidecar data was not removed:', error)
  )
}
