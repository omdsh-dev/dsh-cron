/** Non-blocking cross-process directory lock with stale-pid takeover. */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DirLock {
  readonly acquired: boolean
  readonly reason: 'acquired' | 'held' | 'exhausted'
  readonly heldBy: number | null
  release(): void
}

function readLockPid(lockDir: string): number | null {
  try {
    const pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim())
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch { return null }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function acquireDirLock(lockDir: string, attempts = 2): DirLock {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, 'pid'), String(process.pid))
      let held = true
      return {
        acquired: true, reason: 'acquired', heldBy: null,
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
        return { acquired: false, reason: 'held', heldBy: pid, release: () => {} }
      }
      rmSync(lockDir, { recursive: true, force: true })
    }
  }
  return { acquired: false, reason: 'exhausted', heldBy: null, release: () => {} }
}
