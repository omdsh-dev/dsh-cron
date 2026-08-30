import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`)
  return process.argv[index + 1]
}

function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    if (options.allowFailure === true) return undefined
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

const ref = argument('--ref')
const versionArgument = argument('--version')
const requestedVersion = versionArgument.startsWith('v') ? versionArgument.slice(1) : versionArgument
const commitPattern = new RegExp('^[0-9a-f]{40}$')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (manifest.version !== requestedVersion) {
  throw new Error(`package version ${manifest.version} does not match requested release ${requestedVersion}`)
}
if (git(['status', '--porcelain']) !== '') throw new Error('release checkout is not clean')

const head = git(['rev-parse', 'HEAD'])
const main = git(['rev-parse', 'refs/remotes/origin/main'])
if (commitPattern.test(ref)) {
  if (head !== ref) throw new Error(`release candidate checkout ${head} does not match ${ref}`)
  if (head !== main) throw new Error('release candidate must be the current origin/main commit')
} else {
  const expectedTag = `v${requestedVersion}`
  if (ref !== expectedTag) throw new Error(`release tag ${ref} does not match ${expectedTag}`)
  if (git(['cat-file', '-t', `refs/tags/${ref}`], { allowFailure: true }) !== 'tag') {
    throw new Error(`release tag ${ref} must be annotated`)
  }
  if (git(['rev-parse', `${ref}^{commit}`]) !== head) throw new Error(`release tag ${ref} does not resolve to HEAD`)
  if (spawnSync('git', ['merge-base', '--is-ancestor', head, 'refs/remotes/origin/main'], { cwd: root }).status !== 0) {
    throw new Error(`release tag ${ref} is not in origin/main history`)
  }
}

console.log(`release identity verified: ${ref} -> ${head} (version ${requestedVersion})`)
