import type { ProcessSpec } from '@orca/process-host/process-spec'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RunProcessModule from '@orca/process-host'

const { spawnProcessMock } = vi.hoisted(() => ({
  spawnProcessMock: vi.fn<(spec: ProcessSpec) => ReturnType<typeof RunProcessModule.spawnProcess>>()
}))

// Swap only the executable; retain real spawning, argv/env handling and a signalable PID.
vi.mock('@orca/process-host', async (importOriginal) => ({
  ...(await importOriginal<typeof RunProcessModule>()),
  spawnProcess: spawnProcessMock
}))
// Real macOS installs would register a park in the developer’s home.
vi.mock('./orcad-browser-install-park', () => ({ openOrcadBrowserInstallPark: () => null }))

import { readRuntimeMetadataAsync } from '../runtime/rpc/server/runtime-metadata'
import { ElectronServeBrowserProcess } from './electron-serve-browser-process'

const FAKE_SIDECAR = join(import.meta.dirname, '__fixtures__', 'fake-orcad-electron-sidecar.cjs')
const INSTALLED_EXECUTABLE = join('/Applications', 'Orca.app', 'Contents', 'MacOS', 'Orca')

let harnessRoot: string
let profileDir: string
let started: ElectronServeBrowserProcess[]

async function startProvider(): Promise<ElectronServeBrowserProcess> {
  const processHandle = new ElectronServeBrowserProcess(INSTALLED_EXECUTABLE, harnessRoot)
  started.push(processHandle)
  await processHandle.start()
  return processHandle
}

function spawnedProfile(call: number): string {
  const spec: ProcessSpec = spawnProcessMock.mock.calls[call][0]
  return (spec.args ?? []).find((arg) => arg.startsWith('--user-data-dir='))!.slice(16)
}

async function sidecarPid(profile: string): Promise<number> {
  const metadata = await readRuntimeMetadataAsync(profile)
  if (!metadata) {
    throw new Error(`No runtime metadata in ${profile}`)
  }
  return metadata.pid
}

beforeEach(async () => {
  harnessRoot = await mkdtemp(join(tmpdir(), 'orcad-electron-profile-'))
  profileDir = join(harnessRoot, 'profile')
  started = []
  const logPath = join(harnessRoot, 'requests.jsonl')
  const controlPath = join(harnessRoot, 'control.json')
  await writeFile(logPath, '')
  await writeFile(controlPath, '{}')
  vi.stubEnv('ORCA_BROWSER_PROFILE_DIR', profileDir)
  const actual = await vi.importActual<typeof RunProcessModule>('@orca/process-host')
  spawnProcessMock.mockReset()
  spawnProcessMock.mockImplementation((spec: ProcessSpec) =>
    actual.spawnProcess({
      ...spec,
      program: process.execPath,
      args: [FAKE_SIDECAR, ...(spec.args ?? [])],
      env: { ...spec.env, ORCA_FAKE_SIDECAR_LOG: logPath, ORCA_FAKE_SIDECAR_CONTROL: controlPath }
    })
  )
})

afterEach(async () => {
  for (const processHandle of started) {
    await processHandle.stop()
  }
  vi.unstubAllEnvs()
  await rm(harnessRoot, { recursive: true, force: true })
})

describe('ElectronServeBrowserProcess persistent profile (ORCA_BROWSER_PROFILE_DIR)', () => {
  it('runs the sidecar on the configured profile and keeps it when stopping', async () => {
    const processHandle = await startProvider()
    expect(spawnedProfile(0)).toBe(profileDir)
    const pid = await sidecarPid(profileDir)
    await writeFile(join(profileDir, 'Cookies'), 'signed-in')

    await processHandle.stop()

    expect(() => process.kill(pid, 0)).toThrow()
    expect(await readFile(join(profileDir, 'Cookies'), 'utf8')).toBe('signed-in')
  })

  it.skipIf(process.platform === 'win32')('creates the profile privately', async () => {
    await startProvider()
    expect((await stat(profileDir)).mode & 0o777).toBe(0o700)
  })

  it('never records the profile for leftover removal', async () => {
    await startProvider()
    started.length = 0
    process.kill(await sidecarPid(profileDir), 'SIGKILL')
    await writeFile(join(profileDir, 'Cookies'), 'signed-in')

    await startProvider()

    expect(spawnedProfile(1)).toBe(profileDir)
    expect(await readFile(join(profileDir, 'Cookies'), 'utf8')).toBe('signed-in')
  })

  it('stops a sidecar a crashed orcad left on the profile and reuses the profile', async () => {
    await startProvider()
    started.length = 0
    const orphanPid = await sidecarPid(profileDir)

    await startProvider()

    expect(() => process.kill(orphanPid, 0)).toThrow()
    expect(spawnedProfile(1)).toBe(profileDir)
    expect(await sidecarPid(profileDir)).not.toBe(orphanPid)
  })

  it('rejects a relative path without launching', async () => {
    vi.stubEnv('ORCA_BROWSER_PROFILE_DIR', 'relative/profile')
    await expect(startProvider()).rejects.toThrow(/must be an absolute path/)
    expect(spawnProcessMock).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a path too long for the sidecar socket',
    async () => {
      vi.stubEnv('ORCA_BROWSER_PROFILE_DIR', join(harnessRoot, 'p'.repeat(80)))
      await expect(startProvider()).rejects.toThrow(/at most 80 bytes/)
      expect(spawnProcessMock).not.toHaveBeenCalled()
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses a profile other users can read, and leaves it untouched',
    async () => {
      await mkdir(profileDir, { mode: 0o755 })
      await chmod(profileDir, 0o755)
      await writeFile(join(profileDir, 'keep'), '')

      await expect(startProvider()).rejects.toThrow(/mode 0700/)

      expect(spawnProcessMock).not.toHaveBeenCalled()
      expect(existsSync(join(profileDir, 'keep'))).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')('refuses a symlinked profile', async () => {
    const target = join(harnessRoot, 'target')
    await mkdir(target, { mode: 0o700 })
    await symlink(target, profileDir)

    await expect(startProvider()).rejects.toThrow(/not a symlink/)
    expect(spawnProcessMock).not.toHaveBeenCalled()
  })
})
