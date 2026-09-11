export const exactCommitPattern = new RegExp('^[0-9a-f]{40}$')

const releaseTagPattern = new RegExp(
  '^v[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
)

export function isExactGitInstallRef(ref) {
  return exactCommitPattern.test(ref) || releaseTagPattern.test(ref)
}
