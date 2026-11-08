import { describe, expect, it } from 'vitest'
import { compareAppVersions } from './app-version'
import {
  FORK_BUILD,
  forkAwareAppVersion,
  getAppReleaseRepo,
  isForkReleaseVersion,
  parseForkBuild
} from './fork-build'

const fork = parseForkBuild({ version: '1.4.253-hub.4', repo: 'example/orca-fork' })

describe('fork build identity', () => {
  it('is absent in builds without the stamp, which behave like upstream', () => {
    expect(FORK_BUILD).toBeNull()
    expect(forkAwareAppVersion('1.4.253')).toBe('1.4.253')
    expect(getAppReleaseRepo()).toBe('stablyai/orca')
    expect(isForkReleaseVersion('1.4.253-hub.4')).toBe(false)
  })

  it('parses a stamped release tag and repo', () => {
    expect(fork).toEqual({
      version: '1.4.253-hub.4',
      baseVersion: '1.4.253',
      repo: 'example/orca-fork'
    })
    expect(getAppReleaseRepo(fork)).toBe('example/orca-fork')
  })

  it('rejects a malformed stamp instead of half-enabling the fork', () => {
    expect(() => parseForkBuild({ version: '1.4.253', repo: 'example/orca-fork' })).toThrow()
    expect(() => parseForkBuild({ version: 'v1.4.253-hub.4', repo: 'example/orca-fork' })).toThrow()
    expect(() => parseForkBuild({ version: '1.4.253-hub.4', repo: 'orca-fork' })).toThrow()
    expect(() => parseForkBuild({ version: '1.4.253-hub.4', repo: 'example/orca"fork' })).toThrow()
  })

  it('reports the release tag only for the app version the build is based on', () => {
    expect(forkAwareAppVersion('1.4.253', fork)).toBe('1.4.253-hub.4')
    // Already the tag, or another base: left alone.
    expect(forkAwareAppVersion('1.4.253-hub.4', fork)).toBe('1.4.253-hub.4')
    expect(forkAwareAppVersion('1.4.254', fork)).toBe('1.4.254')
  })

  it('recognizes fork release tags with or without the v', () => {
    expect(isForkReleaseVersion('1.4.253-hub.5', fork)).toBe(true)
    expect(isForkReleaseVersion('v1.4.254-hub.1', fork)).toBe(true)
    expect(isForkReleaseVersion('1.4.254-rc.1', fork)).toBe(false)
    expect(isForkReleaseVersion('1.4.254', fork)).toBe(false)
  })

  it('orders fork tags by base version, then by hub number', () => {
    expect(compareAppVersions('1.4.253-hub.5', '1.4.253-hub.4')).toBeGreaterThan(0)
    expect(compareAppVersions('1.4.253-hub.10', '1.4.253-hub.9')).toBeGreaterThan(0)
    expect(compareAppVersions('1.4.254-hub.1', '1.4.253-hub.12')).toBeGreaterThan(0)
  })
})
