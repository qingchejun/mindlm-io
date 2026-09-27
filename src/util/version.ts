/**
 * Kept in sync with package.json by `test/unit/version.test.ts` — bump both in
 * the same commit. Reading package.json at runtime would mean guessing at the
 * path from both `src/` and `dist/`, which is worse than one asserted constant.
 */
export const VERSION = '0.1.0';

export const REPO_URL = 'https://github.com/qingchejun/mindlm-io';

export const USER_AGENT = `mindlm-mcp/${VERSION} (+${REPO_URL})`;
