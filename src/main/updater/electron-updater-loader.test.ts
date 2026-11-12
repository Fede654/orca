import { describe, expect, it } from 'vitest'
import { forkAwareAppVersion, parseForkBuild } from '../../shared/fork-build'
import { applyForkReleaseVersion } from './electron-updater-loader'

// Stands in for semver's SemVer, which electron-updater builds currentVersion from.
class FakeSemVer {
  constructor(readonly version: string) {}
}

function updaterAt(version: string): { currentVersion: FakeSemVer } {
  return { currentVersion: new FakeSemVer(version) }
}

const fork = parseForkBuild({ version: '1.4.253-hub.4', repo: 'example/orca-fork' })
const toForkVersion = (version: string): string => forkAwareAppVersion(version, fork)

describe('applyForkReleaseVersion', () => {
  it('leaves electron-updater on the app version in builds without the stamp', () => {
    const updater = updaterAt('1.4.253')
    const before = updater.currentVersion
    applyForkReleaseVersion(updater)
    expect(updater.currentVersion).toBe(before)
  })

  it('makes electron-updater compare by the fork release tag', () => {
    const updater = updaterAt('1.4.253')
    applyForkReleaseVersion(updater, toForkVersion)
    expect(updater.currentVersion).toBeInstanceOf(FakeSemVer)
    expect(updater.currentVersion.version).toBe('1.4.253-hub.4')
  })

  it('is idempotent across repeated loads', () => {
    const updater = updaterAt('1.4.253')
    applyForkReleaseVersion(updater, toForkVersion)
    const applied = updater.currentVersion
    applyForkReleaseVersion(updater, toForkVersion)
    expect(updater.currentVersion).toBe(applied)
  })

  it('tolerates an updater without currentVersion', () => {
    expect(() => applyForkReleaseVersion({}, toForkVersion)).not.toThrow()
  })
})
