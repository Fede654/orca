// Fork: the fork's release workflow rewrites this file before building, with the release tag
// version (X.Y.Z-hub.N) and the repo that publishes it. Every other build keeps null and
// behaves exactly like upstream. See fork-build.ts.
export const FORK_BUILD_STAMP: { version: string; repo: string } | null = null
