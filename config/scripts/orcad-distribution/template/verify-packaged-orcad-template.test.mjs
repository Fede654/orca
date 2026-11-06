import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR
} from '../../../../src/shared/orcad-artifacts.ts'
import { writeOrcadTemplateTestFixture } from './orcad-template-test-fixture.mjs'

const require = createRequire(import.meta.url)
const {
  packagedOrcadTemplateTargets,
  verifyPackagedOrcadTemplate
} = require('./verify-packaged-orcad-template.cjs')
const roots = []

async function createFixture(options) {
  const root = await mkdtemp(join(tmpdir(), 'orca-packaged-orcad-template-'))
  roots.push(root)
  const templateDir = await writeOrcadTemplateTestFixture(root, options)
  return { root, templateDir }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('verifyPackagedOrcadTemplate', () => {
  it('rejects a page asset changed after manifest generation', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.templateDir, 'out/mobile-web/index.html'), 'mutated')

    expect(() => verifyPackagedOrcadTemplate(fixture.root)).toThrow(
      'out/mobile-web/index.html checksum mismatch'
    )
  })

  it('rejects a target whose runtime reference names another Node', async () => {
    const fixture = await createFixture()
    const markerPath = join(
      fixture.templateDir,
      ORCAD_TEMPLATE_TARGETS_DIR,
      'darwin-arm64',
      ORCAD_NODE_RUNTIME_MARKER_FILENAME
    )
    await writeFile(markerPath, `${'0'.repeat(64)}\n`)
    const manifestPath = join(fixture.templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.targets['darwin-arm64'].files[ORCAD_NODE_RUNTIME_MARKER_FILENAME] = createHash(
      'sha256'
    )
      .update(`${'0'.repeat(64)}\n`)
      .digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest))

    expect(() => verifyPackagedOrcadTemplate(fixture.root)).toThrow(
      'darwin-arm64 runtime reference disagrees'
    )
  })

  // Desktop must carry deployment template on every OS: SSH/managed deploys materialize target slot from resourcesPath (D2).
})

describe('ORCA_ORCAD_TEMPLATE_TARGETS', () => {
  async function linuxOnlyFixture() {
    const fixture = await createFixture()
    const manifestPath = join(fixture.templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const target of Object.keys(manifest.targets)) {
      if (target !== 'linux-x64-glibc') {
        delete manifest.targets[target]
        rmSync(join(fixture.templateDir, ORCAD_TEMPLATE_TARGETS_DIR, target), { recursive: true })
      }
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    return fixture
  }

  it('keeps every target when unset', () => {
    expect(packagedOrcadTemplateTargets({})).toContain('darwin-arm64')
    expect(packagedOrcadTemplateTargets({ ORCA_ORCAD_TEMPLATE_TARGETS: ' ' })).toContain(
      'win32-x64'
    )
  })

  it('verifies a template narrowed to the listed targets', async () => {
    const fixture = await linuxOnlyFixture()
    const targets = packagedOrcadTemplateTargets({ ORCA_ORCAD_TEMPLATE_TARGETS: 'linux-x64-glibc' })

    expect(() => verifyPackagedOrcadTemplate(fixture.root, targets)).not.toThrow()
    expect(() => verifyPackagedOrcadTemplate(fixture.root)).toThrow('target manifest inventory')
  })

  it('rejects an unknown target', () => {
    expect(() =>
      packagedOrcadTemplateTargets({ ORCA_ORCAD_TEMPLATE_TARGETS: 'linux-x64-glibc,beos-x86' })
    ).toThrow('unknown targets: beos-x86')
  })
})
