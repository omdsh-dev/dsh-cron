import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dryRun = process.argv.includes('--dry-run')
const packageSpec = `${manifest.name}@${manifest.version}`
const distTag = manifest.publishConfig?.tag
const repository = 'git+https://github.com/cofy-x/dsh-cron.git'
const registryVisibilityAttempts = 60
const registryVisibilityIntervalMs = 5_000

if (manifest.name !== '@cofy-x/dsh-cron') throw new Error(`unexpected package name ${manifest.name}`)
if (manifest.publishConfig?.access !== 'public') throw new Error('package must publish with public access')
if (distTag !== 'latest') throw new Error('package must publish on the latest channel')
if (manifest.repository?.url !== repository) throw new Error('package repository metadata is not canonical')

if (dryRun) {
  execFileSync('npm', ['publish', '.', '--dry-run', '--access', 'public', '--tag', distTag], { cwd: root, stdio: 'inherit' })
  process.stdout.write(`dry-run: ${packageSpec} would publish with dist-tag ${distTag}\n`)
  process.exit(0)
}

verifyReleaseContext()
const existing = registryManifest()
if (existing !== undefined) {
  verifyRegistryIdentity(existing)
  process.stdout.write(`skip ${packageSpec}: already published by this repository\n`)
  process.exit(0)
}

execFileSync('npm', ['publish', '.', '--access', 'public', '--tag', distTag, '--provenance'], {
  cwd: root,
  stdio: 'inherit',
})

for (let attempt = 1; attempt <= registryVisibilityAttempts; attempt += 1) {
  const published = registryManifest()
  if (published !== undefined) {
    verifyRegistryIdentity(published)
    process.stdout.write(`published ${packageSpec} with dist-tag ${distTag}\n`)
    process.exit(0)
  }
  await new Promise(resolve => setTimeout(resolve, registryVisibilityIntervalMs))
}
const registryVisibilitySeconds = registryVisibilityAttempts * registryVisibilityIntervalMs / 1_000
throw new Error(`${packageSpec} was published but did not become visible within ${registryVisibilitySeconds} seconds`)

function verifyReleaseContext() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('real publication is restricted to GitHub Actions')
  const releaseSha = process.env.RELEASE_SHA
  if (releaseSha === undefined) throw new Error('RELEASE_SHA is required for publication')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (head !== releaseSha) throw new Error(`release checkout ${head} does not match ${releaseSha}`)
  execFileSync(process.execPath, [join(root, 'scripts/verify-release.mjs'), '--ref', `v${manifest.version}`, '--version', manifest.version], {
    cwd: root,
    stdio: 'inherit',
  })
}

function registryManifest() {
  const result = spawnSync('npm', ['view', packageSpec, '--json'], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`
    if (diagnostic.includes('E404')) return undefined
    throw new Error(`npm view failed for ${packageSpec}: ${result.stderr.trim() || `exit ${result.status}`}`)
  }
  return JSON.parse(result.stdout)
}

function verifyRegistryIdentity(published) {
  const publishedRepository = typeof published.repository === 'string' ? published.repository : published.repository?.url
  if (published.name !== manifest.name || published.version !== manifest.version || publishedRepository !== repository) {
    throw new Error(`${packageSpec} exists but does not belong to this repository`)
  }
}
