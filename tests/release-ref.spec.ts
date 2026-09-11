import { describe, expect, it } from 'vitest'

// @ts-expect-error The runtime release helper is intentionally plain ESM for direct Node use.
import { isExactGitInstallRef } from '../scripts/release-ref.mjs'

describe('Git-install release refs', () => {
  it.each([
    '0123456789abcdef0123456789abcdef01234567',
    'v0.8.0',
    'v0.8.0-alpha.2',
    'v1.2.3-rc.1+build.5',
  ])('accepts exact commit or SemVer release ref %s', (ref) => {
    expect(isExactGitInstallRef(ref)).toBe(true)
  })

  it.each([
    'main',
    'v0.8',
    'v0.8.0-',
    '6d85767',
    'refs/tags/v0.8.0-alpha.2',
  ])('rejects mutable or malformed ref %s', (ref) => {
    expect(isExactGitInstallRef(ref)).toBe(false)
  })
})
