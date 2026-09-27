<!-- Thanks for the patch. Keep this short; the checklist matters more than the prose. -->

## What this changes

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## Why

<!-- What was wrong, or what was missing. -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` all pass
- [ ] Tests cover the change (new behaviour, or a regression test for the bug)
- [ ] No API keys, tokens, internal URLs or personal paths in the diff
- [ ] `src/` still contains no reference to a website or a backend service
- [ ] README / `.env.example` updated if a flag, tool argument or variable changed
