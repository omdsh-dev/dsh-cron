/**
 * Single-instance scheduler lock. Two dsh processes sharing one Harness home
 * both load this plugin; without coordination each would fire every job. The
 * lock holder runs the scheduler; other instances stay management-only.
 * @module dsh-cron/lock
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SchedulerLock {
  /** Whether this process holds the lock and may run the scheduler. */
  readonly acquired: boolean
  /** Release the lock; a no-op when not held. */
  release(): void
}

function readLockPid(lockDir: string): number | null {
  try {
    const text = readFileSync(join(lockDir, 'pid'), 'utf8').trim()
    const pid = Number(text)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH means the holder is gone and the lock is stale; EPERM means it
    // exists but is owned by another user — still held.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Acquire the scheduler lock under the store directory.
 * @param dataDir - the cron store directory.
 * @param warn - sink for the passive-mode notice.
 * @returns the lock handle; `acquired: false` means another live process owns it.
 */
export function acquireSchedulerLock(dataDir: string, warn: (message: string) => void): SchedulerLock {
  const lockDir = join(dataDir, 'scheduler.lock')
  // The store directory may not exist yet on a fresh home; the lock mkdir
  // itself must stay non-recursive so an existing lock keeps failing.
  mkdirSync(dataDir, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, 'pid'), String(process.pid))
      let held = true
      return {
        get acquired() { return held },
        release() {
          if (!held) return
          held = false
          rmSync(lockDir, { recursive: true, force: true })
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const pid = readLockPid(lockDir)
      if (pid !== null && pidAlive(pid)) {
        warn(`dsh-cron: another instance (pid ${pid}) owns the scheduler; this one is management-only`)
        return { acquired: false, release: () => {} }
      }
      // The holder died without cleanup; take the lock over.
      rmSync(lockDir, { recursive: true, force: true })
    }
  }
  warn('dsh-cron: scheduler lock contention; this instance is management-only')
  return { acquired: false, release: () => {} }
}
