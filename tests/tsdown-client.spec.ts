import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCssModulePath } from '../tsdown.client.ts'

describe('resolveCssModulePath', () => {
  it('resolves a module stylesheet beside its importer', () => {
    const importer = join(process.cwd(), 'src', 'client', 'CronPanel.tsx')

    expect(resolveCssModulePath('./CronPanel.module.css', importer)).toBe(
      join(dirname(importer), 'CronPanel.module.css'),
    )
  })

  it('decodes file URL characters without losing the platform path', () => {
    const importer = join(process.cwd(), 'fixtures', '带 空格', 'Panel.tsx')

    expect(resolveCssModulePath('./Panel module.css', importer)).toBe(
      join(dirname(importer), 'Panel module.css'),
    )
  })

  it('leaves an entry stylesheet unchanged when there is no importer', () => {
    expect(resolveCssModulePath('src/client/CronPanel.module.css', undefined)).toBe(
      'src/client/CronPanel.module.css',
    )
  })
})
