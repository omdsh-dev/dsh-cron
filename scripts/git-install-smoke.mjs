import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { exactCommitPattern, isExactGitInstallRef } from './release-ref.mjs'

const PACKAGE_NAME = '@cofy-x/dsh-cron'
const REPOSITORY = 'cofy-x/dsh-cron'
const TEMP_PREFIX = 'dsh-cron'
const root = dirname(dirname(fileURLToPath(import.meta.url)))

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`)
  return process.argv[index + 1]
}

function run(command, args, cwd) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  return result.stdout.trim()
}

const ref = argument('--ref')
if (!isExactGitInstallRef(ref)) throw new Error('Git-install smoke ref must be an exact commit or release tag')
const resolvedCommit = exactCommitPattern.test(ref) ? ref : capture('git', ['rev-parse', `${ref}^{commit}`], root)
if (!exactCommitPattern.test(resolvedCommit)) throw new Error(`could not resolve ${ref} to an exact commit`)

const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const profileDependencies = new Map()
for (const [name, version] of Object.entries(expected.devDependencies ?? {})) {
  if (name.startsWith('@deepseek-ai/') && typeof version === 'string') profileDependencies.set(name, version)
}
for (const name of Object.keys(expected.peerDependencies ?? {})) {
  const version = expected.devDependencies?.[name] ?? expected.dshSmoke?.peerSources?.[name]
  if (typeof version !== 'string') throw new Error(`no audited smoke version is configured for peer ${name}`)
  profileDependencies.set(name, version)
}
for (const [name, version] of Object.entries(expected.dshSmoke?.profileOverrides ?? {})) {
  if (typeof version !== 'string') throw new Error(`audited smoke profile override for ${name} must be a string`)
  profileDependencies.set(name, version)
}
const auditedProfile = [...profileDependencies].map(([name, version]) => `${name}@${version}`)
const peerBuildAllowlist = []
for (const [name, source] of Object.entries(expected.dshSmoke?.peerSources ?? {})) {
  const match = typeof source === 'string' ? new RegExp('^github:([^#]+)#([0-9a-f]{40})$').exec(source) : null
  if (match === null) throw new Error(`audited peer source for ${name} must pin an exact GitHub commit`)
  peerBuildAllowlist.push(`  '${name}@https://codeload.github.com/${match[1]}/tar.gz/${match[2]}': true`)
}
const workspace = mkdtempSync(join(tmpdir(), `${TEMP_PREFIX}-git-smoke-`))
try {
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: expected.packageManager }, null, 2))
  writeFileSync(join(workspace, 'pnpm-workspace.yaml'), [
    'packages:',
    "  - '.'",
    'autoInstallPeers: false',
    'allowBuilds:',
    `  '${PACKAGE_NAME}@https://codeload.github.com/${REPOSITORY}/tar.gz/${resolvedCommit}': true`,
    ...peerBuildAllowlist,
    '',
  ].join('\n'))
  // Install the complete audited DSH dependency face. Installing only this
  // plugin's direct peers lets pnpm resolve their peers through npm's default
  // dist-tag, which does not represent DSH's coordinated prerelease profile.
  run('pnpm', ['add', '--save-exact', `github:${REPOSITORY}#${ref}`, ...auditedProfile], workspace)
  run('pnpm', ['peers', 'check'], workspace)

  const require = createRequire(join(workspace, 'smoke.cjs'))
  const entry = require.resolve(PACKAGE_NAME)
  const installedRoot = dirname(dirname(entry))
  const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  if (manifest.version !== expected.version) throw new Error(`installed version ${manifest.version} does not match ${expected.version}`)
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml' || !existsSync(join(installedRoot, 'cordis.patch.yml'))) {
    throw new Error('installed package omitted its DSH bundle patch')
  }
  const plugin = await import(`${pathToFileURL(entry).href}?smoke=${Date.now()}`)
  for (const name of ['name', 'inject', 'Config', 'apply']) {
    if (!(name in plugin)) throw new Error(`installed package omitted export ${name}`)
  }
  if ('default' in plugin) throw new Error('installed package unexpectedly has a default export')
  console.log(`${PACKAGE_NAME} Git-install smoke passed for ${ref}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
