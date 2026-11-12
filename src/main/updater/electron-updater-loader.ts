import type { autoUpdater as electronUpdaterAutoUpdater } from 'electron-updater'
import { forkAwareAppVersion } from '../../shared/fork-build'

export type ElectronAutoUpdater = typeof electronUpdaterAutoUpdater
type UpdaterWithVersion = { readonly currentVersion?: { readonly version: string } }

export function loadElectronAutoUpdater(): ElectronAutoUpdater {
  // Loading validates app.getVersion(); defer until packaged-update guards pass.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The CommonJS package exports the typed autoUpdater singleton.
  const { autoUpdater } = require('electron-updater') as { autoUpdater: ElectronAutoUpdater }
  applyForkReleaseVersion(autoUpdater)
  return autoUpdater
}

// Fork: electron-updater decides "newer" against currentVersion, read once from the app
// version (X.Y.Z). A fork build compares by its release tag, X.Y.Z-hub.N, so the next fork
// release of the same base counts as newer (shared/fork-build.ts).
export function applyForkReleaseVersion(
  updater: UpdaterWithVersion,
  toVersion: (appVersion: string) => string = forkAwareAppVersion
): void {
  const current = updater.currentVersion
  if (!current) {
    return
  }
  const version = toVersion(current.version)
  if (version === current.version) {
    return
  }
  // The declaration is readonly, but electron-updater initializes this as a writable field.
  if (!Reflect.set(updater, 'currentVersion', Reflect.construct(current.constructor, [version]))) {
    throw new Error('Cannot set electron-updater currentVersion')
  }
}
