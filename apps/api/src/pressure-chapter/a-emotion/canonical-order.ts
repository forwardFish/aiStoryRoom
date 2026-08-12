/**
 * Runtime-local mirror of the shared canonical comparator. The API test runner
 * loads the workspace package's last built dist, so importing a newly added
 * source export would make source-only verification depend on an emit step.
 */
export function compareAEmotionCanonicalText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

