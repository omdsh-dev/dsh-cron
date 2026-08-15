import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireSchedulerLock } from '../src/lock.ts'

describe('acquireSchedulerLock', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-cron-lock-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the store directory on a fresh home', () => {
    rmSync(dir, { recursive: true, force: true })
    const lock = acquireSchedulerLock(dir, () => {})
    expect(lock.acquired).toBe(true)
    lock.release()
  })

  it('acquires, records the pid, and releases', () => {
    const lock = acquireSchedulerLock(dir, () => {})
    expect(lock.acquired).toBe(true)
    expect(readFileSync(join(dir, 'scheduler.lock', 'pid'), 'utf8')).toBe(String(process.pid))
    lock.release()
    const again = acquireSchedulerLock(dir, () => {})
    expect(again.acquired).toBe(true)
    again.release()
  })

  it('stays passive while a live process holds the lock', () => {
    const warn = vi.fn()
    mkdirSync(join(dir, 'scheduler.lock'))
    writeFileSync(join(dir, 'scheduler.lock', 'pid'), String(process.pid))
    const lock = acquireSchedulerLock(dir, warn)
    expect(lock.acquired).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('management-only'))
    // A passive lock's release must not steal the holder's directory.
    lock.release()
    expect(readFileSync(join(dir, 'scheduler.lock', 'pid'), 'utf8')).toBe(String(process.pid))
  })

  it('takes over a stale lock from a dead process', () => {
    mkdirSync(join(dir, 'scheduler.lock'))
    // Almost certainly dead: one below the platform pid_max would be racy, use a huge pid.
    writeFileSync(join(dir, 'scheduler.lock', 'pid'), '4194300')
    const lock = acquireSchedulerLock(dir, () => {})
    expect(lock.acquired).toBe(true)
    expect(readFileSync(join(dir, 'scheduler.lock', 'pid'), 'utf8')).toBe(String(process.pid))
    lock.release()
  })
})
