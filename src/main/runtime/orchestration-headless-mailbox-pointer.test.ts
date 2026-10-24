import './rpc/unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import { createRootDispatch } from './orchestration/db/root-dispatch-test-fixture'
import {
  createRuntime,
  LEAF_ID,
  PANE_KEY,
  pointerCount,
  PTY_ID,
  TAB_ID,
  WORKTREE_ID
} from './orchestration-mailbox-notification-test-harness'

describe('headless orchestration mailbox pointer', () => {
  it('delivers a Run message that arrives after the coordinator is idle', async () => {
    vi.useFakeTimers()
    try {
      const db = new OrchestrationDb(':memory:')
      const { runtime, write } = createRuntime(db)
      runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
      const [terminal] = (await runtime.listTerminals()).terminals
      const run = db.createRun({
        objective: 'Headless Run',
        coordinatorHandle: terminal.handle,
        coordinatorPaneKey: PANE_KEY
      })

      runtime.onPtyData(PTY_ID, '\x1b]0;Codex working\x07', 1)
      runtime.onPtyData(PTY_ID, '\x1b]0;Codex done\x07', 2)
      await runtime.serializeMainTerminalBuffer(PTY_ID)
      const message = db.insertMessage({
        from: 'term_worker',
        to: `run:${run.id}`,
        subject: 'Worker complete',
        type: 'worker_done',
        runId: run.id
      })
      runtime.notifyMessageArrived(`run:${run.id}`, 'worker_done')
      await Promise.resolve()

      expect(pointerCount(write)).toBe(1)
      await vi.advanceTimersByTimeAsync(500)
      expect(write).toHaveBeenCalledWith(PTY_ID, '\r')
      expect(db.getMessageById(message.id)?.delivered_at).toEqual(expect.any(String))
      runtime.notifyMessageArrived(`run:${run.id}`, 'worker_done')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(500)
      expect(pointerCount(write)).toBe(1)
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers queued Run mail on the working-to-idle edge', async () => {
    vi.useFakeTimers()
    try {
      const db = new OrchestrationDb(':memory:')
      const { runtime, write } = createRuntime(db)
      runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
      const [terminal] = (await runtime.listTerminals()).terminals
      const run = db.createRun({
        objective: 'Headless edge Run',
        coordinatorHandle: terminal.handle,
        coordinatorPaneKey: PANE_KEY
      })
      runtime.onPtyData(PTY_ID, '\x1b]0;Codex working\x07', 1)
      await runtime.serializeMainTerminalBuffer(PTY_ID)
      const message = db.insertMessage({
        from: 'term_worker',
        to: `run:${run.id}`,
        subject: 'Queued completion',
        type: 'worker_done',
        runId: run.id
      })
      runtime.notifyMessageArrived(`run:${run.id}`, 'worker_done')
      await Promise.resolve()
      expect(pointerCount(write)).toBe(0)

      runtime.onPtyData(PTY_ID, '\x1b]0;Codex done\x07', 2)
      await runtime.serializeMainTerminalBuffer(PTY_ID)
      expect(pointerCount(write)).toBe(1)
      await vi.advanceTimersByTimeAsync(500)
      expect(write).toHaveBeenCalledWith(PTY_ID, '\r')
      expect(db.getMessageById(message.id)?.delivered_at).toEqual(expect.any(String))
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers an active Dispatch mailbox to its headless worker', async () => {
    vi.useFakeTimers()
    try {
      const db = new OrchestrationDb(':memory:')
      const { runtime, write } = createRuntime(db)
      runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
      const [terminal] = (await runtime.listTerminals()).terminals
      const run = db.createRun({
        objective: 'Headless Dispatch',
        coordinatorHandle: 'term_coordinator',
        coordinatorPaneKey:
          '33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444'
      })
      const task = db.createTask({ spec: 'Read guidance', runId: run.id })
      const dispatch = createRootDispatch(
        db,
        task.id,
        terminal.handle,
        PANE_KEY,
        undefined,
        'pty-mailbox:mailbox-incarnation'
      )
      runtime.onPtyData(PTY_ID, '\x1b]0;Codex done\x07', 1)
      await runtime.serializeMainTerminalBuffer(PTY_ID)
      const message = db.insertMessage({
        from: 'term_coordinator',
        to: `dispatch:${dispatch.id}`,
        subject: 'Review result',
        type: 'status',
        runId: run.id
      })

      runtime.notifyMessageArrived(`dispatch:${dispatch.id}`, 'status')
      await Promise.resolve()
      expect(pointerCount(write)).toBe(1)
      await vi.advanceTimersByTimeAsync(500)
      expect(write).toHaveBeenCalledWith(PTY_ID, '\r')
      expect(db.getMessageById(message.id)?.delivered_at).toEqual(expect.any(String))
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps mail pending after the headless PTY exits', async () => {
    vi.useFakeTimers()
    try {
      const db = new OrchestrationDb(':memory:')
      const { runtime, write } = createRuntime(db)
      runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
      const [terminal] = (await runtime.listTerminals()).terminals
      const run = db.createRun({
        objective: 'Exited Run',
        coordinatorHandle: terminal.handle,
        coordinatorPaneKey: PANE_KEY
      })
      runtime.onPtyData(PTY_ID, '\x1b]0;Codex done\x07', 1)
      await runtime.serializeMainTerminalBuffer(PTY_ID)
      runtime.onPtyExit(PTY_ID, 0)
      const message = db.insertMessage({
        from: 'term_worker',
        to: `run:${run.id}`,
        subject: 'After exit',
        type: 'worker_done',
        runId: run.id
      })

      runtime.notifyMessageArrived(`run:${run.id}`, 'worker_done')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(500)

      expect(pointerCount(write)).toBe(0)
      expect(db.getMessageById(message.id)?.delivered_at).toBeNull()
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not use the parked PTY after a graph leaf claims its pane', async () => {
    vi.useFakeTimers()
    try {
      const db = new OrchestrationDb(':memory:')
      const { runtime, write } = createRuntime(db)
      runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
      const [terminal] = (await runtime.listTerminals()).terminals
      const run = db.createRun({
        objective: 'Adopted pane',
        coordinatorHandle: terminal.handle,
        coordinatorPaneKey: PANE_KEY
      })
      runtime.onPtyData(PTY_ID, '\x1b]0;Codex done\x07', 1)
      await runtime.serializeMainTerminalBuffer(PTY_ID)
      runtime.syncWindowGraph(1, {
        tabs: [
          {
            tabId: TAB_ID,
            worktreeId: WORKTREE_ID,
            title: 'Replacement',
            activeLeafId: LEAF_ID,
            layout: null
          }
        ],
        leaves: [
          {
            tabId: TAB_ID,
            worktreeId: WORKTREE_ID,
            leafId: LEAF_ID,
            paneRuntimeId: 2,
            ptyId: 'pty-replacement'
          }
        ]
      })
      const message = db.insertMessage({
        from: 'term_worker',
        to: `run:${run.id}`,
        subject: 'After adoption',
        type: 'worker_done',
        runId: run.id
      })

      runtime.notifyMessageArrived(`run:${run.id}`, 'worker_done')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(500)

      expect(pointerCount(write)).toBe(0)
      expect(db.getMessageById(message.id)?.delivered_at).toBeNull()
      db.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
