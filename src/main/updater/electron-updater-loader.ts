import type { autoUpdater as electronUpdaterAutoUpdater } from 'electron-updater'
import { forkAwareAppVersion } from '../../shared/fork-build'

export type ElectronAutoUpdater = typeof electronUpdaterAutoUpdater

export function loadElectronAutoUpdater(): ElectronAutoUpdater {
  // Loading validates app.getVersion(); defer until packaged-update guards pass.
  const { autoUpdater } = require('electron-updater') as { autoUpdater: ElectronAutoUpdater }
  applyForkReleaseVersion(autoUpdater)
  return autoUpdater
}

// Fork: electron-updater decides "newer" against currentVersion, read once from the app
// version (X.Y.Z). A fork build compares by its release tag, X.Y.Z-hub.N, so the next fork
// release of the same base counts as newer (shared/fork-build.ts).
export function applyForkReleaseVersion(
  updater: Pick<ElectronAutoUpdater, 'currentVersion'>,
  toVersion: (appVersion: string) => string = forkAwareAppVersion
): void {
  const current = updater.currentVersion as ElectronAutoUpdater['currentVersion'] | undefined
  if (!current) {
    return
  }
  const version = toVersion(current.version)
  if (version === current.version) {
    return
  }
  const SemVer = current.constructor as new (version: string) => typeof current
  ;(updater as { currentVersion: typeof current }).currentVersion = new SemVer(version)
}
