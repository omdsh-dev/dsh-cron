import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, any>

describe('client bundle manifest', () => {
  it('declares the ./client export and the web client manifest', () => {
    expect(manifest.exports['./client'].default).toBe('./lib/client.js')
    expect(manifest.exports['./client'].types).toBe('./lib/types/client/index.d.ts')
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('keeps react and client packages as optional peers', () => {
    expect(manifest.peerDependencies.react).toBe('^18.2.0')
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(manifest.peerDependenciesMeta[name]?.optional, name).toBe(true)
    }
  })
})
