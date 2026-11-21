import { beforeEach, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  contents: null as string | null,
  failWrite: false,
  nextWrite: null as { started: () => void; gate: Promise<void> } | null
}))
vi.mock('node:fs/promises', () => ({
  mkdir: async () => undefined,
  readFile: async () => {
    if (disk.contents === null) throw new Error('missing')
    return disk.contents
  },
  writeFile: async (_path: string, text: string) => {
    const held = disk.nextWrite
    disk.nextWrite = null
    held?.started()
    if (held) await held.gate
    if (disk.failWrite) {
      disk.failWrite = false
      throw new Error('disk write failed')
    }
    disk.contents = text
  },
  rm: async () => {
    disk.contents = null
  }
}))

import {
  clearRemoteSttEndpoint,
  readRemoteSttBaseUrl,
  saveRemoteSttEndpoint
} from './remote-stt-endpoint-store'

beforeEach(async () => {
  await clearRemoteSttEndpoint()
  disk.failWrite = false
  disk.nextWrite = null
})

it('preserves save, clear and replacement order while the first disk write is pending', async () => {
  const started = Promise.withResolvers<void>()
  const held = Promise.withResolvers<void>()
  disk.nextWrite = { started: started.resolve, gate: held.promise }
  const first = saveRemoteSttEndpoint('http://first.example:8000')
  await started.promise
  const cleared = clearRemoteSttEndpoint()
  const replacement = saveRemoteSttEndpoint('http://last.example:9000/v1')
  const read = readRemoteSttBaseUrl()
  held.resolve()
  await Promise.all([first, cleared, replacement])
  await expect(read).resolves.toBe('http://last.example:9000')
})

it('continues queued changes after a failed disk write and preserves the error for its caller', async () => {
  disk.failWrite = true
  const failed = saveRemoteSttEndpoint('http://first.example:8000')
  const next = saveRemoteSttEndpoint('http://recovered.example:9000')
  await expect(failed).rejects.toThrow('disk write failed')
  await expect(next).resolves.toBe('http://recovered.example:9000')
  await expect(readRemoteSttBaseUrl()).resolves.toBe('http://recovered.example:9000')
})
