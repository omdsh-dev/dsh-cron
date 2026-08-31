import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CronStore, type CronJob } from '../src/store.ts'

function makeJob(id: string): CronJob {
  return {
    id,
    prompt: `prompt for ${id}`,
    schedule: { kind: 'at', at: '2027-01-01T00:00:00.000Z' },
    createdBy: null,
    target: { kind: 'fresh', cwd: '/workspace' },
    concurrencyLimit: 1,
    createdAt: '2026-08-15T00:00:00.000Z',
    nextAt: '2027-01-01T00:00:00.000Z',
    lastFiredAt: null,
    fireCount: 0,
    state: 'active',
    paused: false,
    lastRun: null,
    runs: [],
  }
}

describe('CronStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-cron-store-'))
    file = join(dir, 'jobs.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty when the file is missing', () => {
    const store = new CronStore(file, () => {})
    store.load()
    expect(store.list()).toEqual([])
  })

  it('round-trips jobs through disk', () => {
    const warn = vi.fn()
    const store = new CronStore(file, warn)
    store.load()
    store.insert(makeJob(store.allocateId()))
    store.insert(makeJob(store.allocateId()))

    const reloaded = new CronStore(file, warn)
    reloaded.load()
    expect(reloaded.list().map(job => job.id)).toEqual(['cron-1', 'cron-2'])
    expect(reloaded.allocateId()).toBe('cron-3')
    expect(warn).not.toHaveBeenCalled()
  })

  it('allocates collision-free ids and merges concurrent management writes', () => {
    const first = new CronStore(file, () => {})
    const second = new CronStore(file, () => {})
    first.load()
    second.load()
    first.insert(makeJob(first.allocateId()))
    second.insert(makeJob(second.allocateId()))
    first.insert(makeJob(first.allocateId()))
    const reloaded = new CronStore(file, () => {})
    reloaded.load()
    expect(reloaded.list().map(job => job.id)).toEqual(['cron-1', 'cron-2', 'cron-3'])
  })

  it('keeps adopted peer records across repeated local writes', () => {
    const first = new CronStore(file, () => {})
    const second = new CronStore(file, () => {})
    first.load()
    second.load()
    first.insert(makeJob(first.allocateId()))
    second.insert(makeJob(second.allocateId()))
    second.get('cron-2')!.paused = true
    second.flush()
    const reloaded = new CronStore(file, () => {})
    reloaded.load()
    expect(reloaded.list().map(job => job.id)).toEqual(['cron-1', 'cron-2'])
    expect(reloaded.get('cron-2')?.paused).toBe(true)
  })

  it('does not resurrect a record removed while another process holds a stale projection', () => {
    const first = new CronStore(file, () => {})
    first.load()
    first.insert(makeJob(first.allocateId()))
    const second = new CronStore(file, () => {})
    second.load()
    first.remove('cron-1')
    second.insert(makeJob(second.allocateId()))
    const reloaded = new CronStore(file, () => {})
    reloaded.load()
    expect(reloaded.list().map(job => job.id)).toEqual(['cron-2'])
  })

  it('fails closed instead of overwriting peer state on prolonged lock contention', () => {
    mkdirSync(`${file}.lock`)
    writeFileSync(join(`${file}.lock`, 'pid'), String(process.pid))
    const store = new CronStore(file, () => {})
    store.load()
    expect(() => store.allocateId()).toThrow('timed out acquiring store write lock')
    expect(new CronStore(file, () => {}).list()).toEqual([])
  })

  it('quarantines a corrupt file and starts empty', () => {
    writeFileSync(file, 'not json')
    const warn = vi.fn()
    const store = new CronStore(file, warn)
    store.load()
    expect(store.list()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('corrupt'))
  })

  it('drops invalid and duplicate entries with a warning', () => {
    writeFileSync(file, JSON.stringify({
      version: 1,
      seq: 5,
      jobs: [makeJob('cron-1'), { bogus: true }, makeJob('cron-1')],
    }))
    const warn = vi.fn()
    const store = new CronStore(file, warn)
    store.load()
    expect(store.list()).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(store.allocateId()).toBe('cron-6')
  })

  it('migrates v1 jobs to a fresh target when configured and otherwise pauses them safely', () => {
    const legacy = makeJob('cron-1') as unknown as Record<string, unknown>
    delete legacy['target']
    delete legacy['concurrencyLimit']
    delete legacy['runs']
    writeFileSync(file, JSON.stringify({ version: 1, seq: 1, jobs: [legacy] }))

    const migrated = new CronStore(file, () => {}, { kind: 'fresh', cwd: '/migrated' })
    migrated.load()
    expect(migrated.get('cron-1')).toMatchObject({ target: { kind: 'fresh', cwd: '/migrated' }, paused: false })
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2)

    const second = join(dir, 'unconfigured.json')
    writeFileSync(second, JSON.stringify({ version: 1, seq: 1, jobs: [legacy] }))
    const paused = new CronStore(second, () => {})
    paused.load()
    expect(paused.get('cron-1')).toMatchObject({ target: null, paused: true, migrationIssue: expect.any(String) })
  })

  it('rejects an unsupported store format loudly', () => {
    writeFileSync(file, JSON.stringify({ version: 99, jobs: [] }))
    const store = new CronStore(file, () => {})
    expect(() => store.load()).toThrow('unsupported job store format')
  })

  it('removes jobs and persists the removal', () => {
    const store = new CronStore(file, () => {})
    store.load()
    store.insert(makeJob(store.allocateId()))
    expect(store.remove('cron-1')).toBe(true)
    expect(store.remove('cron-1')).toBe(false)
    const reloaded = new CronStore(file, () => {})
    reloaded.load()
    expect(reloaded.list()).toEqual([])
  })

  it('hot-reloads jobs written by another process sharing the file', async () => {
    const onReload = vi.fn()
    const reader = new CronStore(file, () => {})
    reader.load()
    const dispose = reader.watch(onReload, 50)
    try {
      const writer = new CronStore(file, () => {})
      writer.load()
      writer.insert(makeJob(writer.allocateId()))
      await vi.waitFor(() => expect(reader.list().map(job => job.id)).toEqual(['cron-1']))
      expect(onReload).toHaveBeenCalledWith(1)
    } finally {
      dispose()
    }
  })

  it('skips its own writes: no reload fires for local mutations', async () => {
    const onReload = vi.fn()
    const store = new CronStore(file, () => {})
    store.load()
    const dispose = store.watch(onReload, 50)
    try {
      store.insert(makeJob(store.allocateId()))
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(store.list().map(job => job.id)).toEqual(['cron-1'])
      expect(onReload).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })

  it('stops watching after dispose', async () => {
    const onReload = vi.fn()
    const reader = new CronStore(file, () => {})
    reader.load()
    const dispose = reader.watch(onReload, 50)
    dispose()

    const writer = new CronStore(file, () => {})
    writer.load()
    writer.insert(makeJob(writer.allocateId()))
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(reader.list()).toEqual([])
    expect(onReload).not.toHaveBeenCalled()
  })

  it('keeps current state when an external write is corrupt or unsupported', async () => {
    const warn = vi.fn()
    const reader = new CronStore(file, warn)
    reader.load()
    reader.insert(makeJob(reader.allocateId()))
    const dispose = reader.watch(undefined, 50)
    try {
      writeFileSync(file, 'not json')
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(reader.list().map(job => job.id)).toEqual(['cron-1'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('corrupt'))

      writeFileSync(file, JSON.stringify({ version: 99, jobs: [] }))
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(reader.list().map(job => job.id)).toEqual(['cron-1'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsupported job store format'))
    } finally {
      dispose()
    }
  })
})
