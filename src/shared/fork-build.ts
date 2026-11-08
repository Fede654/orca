// Fork: identity of a fork release build. The app version (package.json) stays upstream's
// X.Y.Z so every compatibility check behaves as upstream; the stamp adds the release tag
// version X.Y.Z-hub.N and its repo. With the stamp, About and Settings show the tag
// version and the updater follows the fork's releases instead of upstream's.
import { FORK_BUILD_STAMP } from './fork-build-stamp'

export type ForkBuildStamp = { version: string; repo: string }

export type ForkBuild = {
  /** Release tag version without the v: X.Y.Z-hub.N. */
  version: string
  /** Upstream release the build is based on, the app version: X.Y.Z. */
  baseVersion: string
  /** owner/name of the repo that publishes the fork's releases. */
  repo: string
}

const UPSTREAM_RELEASE_REPO = 'stablyai/orca'
const FORK_VERSION_RE = /^(\d+\.\d+\.\d+)-hub\.(\d+)$/
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

export function parseForkBuild(stamp: ForkBuildStamp | null): ForkBuild | null {
  if (stamp === null) {
    return null
  }
  const match = FORK_VERSION_RE.exec(stamp.version)
  // The workflow validates before stamping; a malformed stamp must not half-enable the fork.
  if (!match || !REPO_RE.test(stamp.repo)) {
    throw new Error(`Invalid fork build stamp: ${JSON.stringify(stamp)}`)
  }
  return { version: stamp.version, baseVersion: match[1], repo: stamp.repo }
}

export const FORK_BUILD = parseForkBuild(FORK_BUILD_STAMP)

/** The version shown and compared by the updater: the fork tag when this is a fork build of appVersion. */
export function forkAwareAppVersion(appVersion: string, fork = FORK_BUILD): string {
  return fork && fork.baseVersion === appVersion ? fork.version : appVersion
}

/** A fork release version (X.Y.Z-hub.N), which the fork treats as stable, not a prerelease. */
export function isForkReleaseVersion(version: string, fork = FORK_BUILD): boolean {
  return fork !== null && FORK_VERSION_RE.test(version.replace(/^v/i, ''))
}

/** Repo whose releases update the app: the fork's in fork builds, upstream's otherwise. */
export function getAppReleaseRepo(fork = FORK_BUILD): string {
  return fork?.repo ?? UPSTREAM_RELEASE_REPO
}
