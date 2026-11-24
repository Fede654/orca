import { resolve } from 'node:path'
import { runProcessSync } from '@orca/process-host'
import { defaultExclude } from 'vitest/config'
import { UNIT_EXCLUDE } from '../config/scripts/ci/unit-selection/dependency-graph/ci-unit-files.mjs'
import { resolvePnpmCliInvocation } from '../config/scripts/tool-invocation/pnpm-cli-invocation.mjs'

const files = UNIT_EXCLUDE.filter((glob) => !defaultExclude.includes(glob)).map((glob) =>
  glob.replace(/\*\*$/, '')
)
if (process.argv.slice(2).join(' ') !== '--run') {
  console.log(JSON.stringify({ manual: true, isolatedCiRequired: true, files }, null, 2))
} else if (process.env.CI !== 'true') {
  throw new Error('Dedicated native/Electron tests require an isolated CI host; use --list locally')
} else {
  const pnpm = resolvePnpmCliInvocation()
  const result = runProcessSync({
    program: pnpm.command,
    args: [...pnpm.prefixArgs, 'test', ...files, '--maxWorkers=1'],
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_BALANCE_UNIT_SHARDS: '0' },
    timeoutMs: 900000
  })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.code ?? 1
}
