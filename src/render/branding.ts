/**
 * The one place in `src/` that mentions mindlm.io, and only as the destination
 * of the opt-in footer link (`--branding` / `branding: true`). Exports are
 * OFF by default and contain no attribution at all.
 *
 * Nothing here is ever fetched — it is a literal href written into the exported
 * HTML. The CI red-line check allows this single file and forbids the string
 * everywhere else under `src/`.
 */
export const BRANDING_URL =
  'https://mindlm.io/?utm_source=export&utm_medium=referral&utm_campaign=mindlm-mcp';

export const BRANDING_LABEL = 'Made with mindlm-mcp · mindlm.io';
