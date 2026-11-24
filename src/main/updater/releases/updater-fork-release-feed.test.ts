import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNetRequestFetchAdapter } from '../testing/updater-net-request.fixture'

// A fork release build: the workflow stamped its tag and repo (shared/fork-build.ts).
vi.mock('../../../shared/fork-build-stamp', () => ({
  FORK_BUILD_STAMP: { version: '1.4.253-hub.4', repo: 'example/orca-fork' }
}))

const { netFetchMock, netRequestMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  netRequestMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock, request: netRequestMock }
}))

vi.mock('./updater-release-api-token', () => ({
  resolveReleaseApiToken: async () => null
}))

const ORIGINAL_PLATFORM = process.platform
const FORK = 'https://github.com/example/orca-fork'

function atomFeed(tags: string[]): string {
  const entries = tags
    .map(
      (tag) =>
        `<entry><updated>2026-11-08T12:00:00Z</updated><link rel="alternate" type="text/html" href="${FORK}/releases/tag/${tag}"/><title>${tag}</title></entry>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><feed>${entries}</feed>`
}

function serveForkReleases(tags: string[], latest: string, older: string[] = []): void {
  netFetchMock.mockImplementation((url: string) => {
    if (url === 'https://api.github.com/repos/example/orca-fork/releases?per_page=20&page=1') {
      return Promise.resolve({
        ok: true,
        json: async () =>
          older.map((tag) => ({
            tag_name: tag,
            published_at: '2026-10-01T00:00:00Z',
            assets: [{ name: 'orca-linux.AppImage' }, { name: 'latest-linux.yml' }]
          }))
      })
    }
    if (url === `${FORK}/releases.atom`) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve(atomFeed(tags)) })
    }
    if (url === `${FORK}/releases/latest`) {
      return Promise.resolve({
        ok: false,
        status: 302,
        headers: { get: () => `${FORK}/releases/tag/${latest}` }
      })
    }
    const manifest = url.match(/\/releases\/download\/([^/]+)\/latest-linux\.yml$/)
    if (url.startsWith(`${FORK}/releases/download/`) && manifest) {
      const version = decodeURIComponent(manifest[1]).replace(/^v/, '')
      const text = `version: ${version}\nfiles:\n  - url: orca-linux.AppImage\npath: orca-linux.AppImage\n`
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) })
    }
    if (url.startsWith(`${FORK}/releases/download/`)) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })
  })
}

describe('updater release feed in a fork build', () => {
  beforeEach(() => {
    vi.resetModules()
    netFetchMock.mockReset()
    netRequestMock.mockReset()
    installNetRequestFetchAdapter(netRequestMock, netFetchMock)
    Object.defineProperty(process, 'platform', { value: 'linux' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM })
  })

  it('offers the next fork release of the same base from the fork repo', async () => {
    serveForkReleases(['v1.4.253-hub.5', 'v1.4.253-hub.4', 'v1.4.253-hub.3'], 'v1.4.253-hub.5')
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')

    const result = await fetchNewerReleaseTagsWithReadiness('1.4.253-hub.4', 2, {
      includePrerelease: true
    })

    // The second tag is upstream's fallback for a missing primary manifest.
    expect(result).toMatchObject({ tags: ['v1.4.253-hub.5', 'v1.4.253-hub.4'], state: 'ready' })
    const urls = netFetchMock.mock.calls.map(([url]) => String(url))
    expect(urls).toContain(`${FORK}/releases.atom`)
    expect(urls).toContain(`${FORK}/releases/download/v1.4.253-hub.5/latest-linux.yml`)
    expect(urls.some((url) => url.includes('stablyai'))).toBe(false)
  })

  it('ignores upstream tags that were pushed to the fork', async () => {
    serveForkReleases(['v1.4.254', 'v1.4.253-hub.5', 'v1.4.253-hub.4'], 'v1.4.253-hub.5')
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')

    await expect(
      fetchNewerReleaseTagsWithReadiness('1.4.253-hub.4', 2, { includePrerelease: true })
    ).resolves.toMatchObject({ tags: ['v1.4.253-hub.5', 'v1.4.253-hub.4'], state: 'ready' })
  })

  it('reports no newer release when the running tag is the latest', async () => {
    serveForkReleases(['v1.4.253-hub.4', 'v1.4.253-hub.3'], 'v1.4.253-hub.4')
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')

    await expect(
      fetchNewerReleaseTagsWithReadiness('1.4.253-hub.4', 2, { includePrerelease: true })
    ).resolves.toMatchObject({ tags: [], state: 'no-newer' })
  })

  it('treats the fork latest release as stable for the no-newer fallback', async () => {
    serveForkReleases(['v1.4.253-hub.4'], 'v1.4.253-hub.4')
    const { fetchLatestStableReleaseTag } = await import('./updater-prerelease-feed')

    await expect(fetchLatestStableReleaseTag()).resolves.toBe('v1.4.253-hub.4')
  })

  it('offers stable fork builds meeting a team minimum without accepting upstream tags', async () => {
    serveForkReleases(['v1.4.254', 'v1.4.254-hub.1', 'v1.4.253-hub.5'], 'v1.4.254-hub.1')
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')
    await expect(
      fetchNewerReleaseTagsWithReadiness('1.4.253-hub.4', 1, {
        includePrerelease: false,
        minimumVersion: '1.4.254'
      })
    ).resolves.toMatchObject({ tags: ['v1.4.254-hub.1'], state: 'ready' })
  })

  it('fills a delayed stable offer from the fork REST history', async () => {
    serveForkReleases(['v1.4.254-hub.1'], 'v1.4.254-hub.1', ['v1.4.253-hub.5'])
    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')
    await expect(
      fetchNewerReleaseTagsWithReadiness('1.4.253-hub.4', 1, {
        includePrerelease: false,
        minReleaseAgeMs: 7 * 86400000,
        now: Date.parse('2026-11-09T00:00:00Z')
      })
    ).resolves.toMatchObject({ tags: ['v1.4.253-hub.5'], state: 'ready' })
    expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('stablyai'))).toBe(false)
  })

  it('preserves required minimum, forced update and delay rules for fork builds', async () => {
    const { requiredMinimumVersion, requiresTeamRelease, releaseSelectionPolicy } =
      await import('./updater-release-policy')
    expect(
      requiredMinimumVersion({ orgIds: ['org'], minimumVersion: '1.4.253' }, '1.4.253-hub.4')
    ).toBeUndefined()
    expect(
      requiredMinimumVersion({ orgIds: ['org'], minimumVersion: '1.4.253-hub.5' }, '1.4.253')
    ).toBe('1.4.253-hub.5')
    expect(
      requiresTeamRelease(
        { orgIds: ['org'], minimumVersion: '1.4.253-hub.5' },
        '1.4.253',
        '1.4.253-hub.5'
      )
    ).toBe(true)
    expect(
      requiresTeamRelease({ orgIds: ['org'], forceUpdates: true }, '1.4.253', '1.4.253-hub.5')
    ).toBe(true)
    expect(
      releaseSelectionPolicy({
        team: {
          orgIds: ['org'],
          minimumVersion: '1.4.254',
          updateChannel: 'stable',
          forceUpdates: true,
          forceUpdateDelayDays: 7
        },
        variant: 'default',
        version: '1.4.253-hub.4',
        includePrerelease: true,
        ignoreDelay: true,
        getUpdateDelayDays: () => 0
      })
    ).toEqual({
      isPerfCheck: false,
      includePrerelease: false,
      delayDays: 7,
      minimumVersion: '1.4.254'
    })
  })

  it('links fork releases to the fork repo and upstream releases to upstream', async () => {
    const { getReleaseNotesUrlForVersion } = await import('../../../shared/updater/release-channel')

    expect(getReleaseNotesUrlForVersion('1.4.253-hub.5')).toBe(
      `${FORK}/releases/tag/v1.4.253-hub.5`
    )
    expect(getReleaseNotesUrlForVersion(null)).toBe(`${FORK}/releases`)
    expect(getReleaseNotesUrlForVersion('1.4.254')).toBe(
      'https://github.com/stablyai/orca/releases/tag/v1.4.254'
    )
  })
})
