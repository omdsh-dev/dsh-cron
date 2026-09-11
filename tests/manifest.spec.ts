import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, any>
const bundlePatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

describe('client bundle manifest', () => {
  it('declares the public scoped package identity', () => {
    expect(manifest.name).toBe('@cofy-x/dsh-cron')
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig).toEqual({ access: 'public', tag: 'latest' })
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/cofy-x/dsh-cron.git',
    })
    expect(bundlePatch).toContain("name: '@cofy-x/dsh-cron'")
  })

  it('declares the ./client export and the web client manifest', () => {
    expect(manifest.exports['./client'].default).toBe('./lib/client.js')
    expect(manifest.exports['./client'].types).toBe('./lib/types/client/index.d.ts')
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('requires Automation while keeping host/client composition peers optional', () => {
    expect(manifest.peerDependencies.react).toBe('^18.2.0')
    expect(manifest.peerDependencies['dsh-automation']).toBe('>=0.2.0-alpha.0 <0.3.0')
    for (const name of Object.keys(manifest.peerDependencies).filter(name => name !== 'dsh-automation')) {
      expect(manifest.peerDependenciesMeta[name]?.optional, name).toBe(true)
    }
  })

  it('targets one coordinated DSH release profile', () => {
    const dshPeers = Object.entries(manifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    const dshDevelopmentPackages = Object.entries(manifest.devDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    const dshSmokePackages = Object.entries(manifest.dshSmoke.profileOverrides)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

    expect(dshPeers.length).toBeGreaterThan(0)
    expect(dshDevelopmentPackages.length).toBeGreaterThan(0)
    expect(dshSmokePackages.length).toBeGreaterThan(0)
    for (const [name, range] of dshPeers) {
      expect(range, name).toBe('>=0.1.5-rc.1 <0.2.0')
    }
    for (const [name, version] of [...dshDevelopmentPackages, ...dshSmokePackages]) {
      expect(version, name).toBe('0.1.5-rc.1')
    }
  })
})
