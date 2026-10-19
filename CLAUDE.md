# Working on boredgames.io

## Keep token use low (the owner's standing request)

- Small asks (a colour, a line of copy, a line break, one component): make the change directly. No helper agents.
- Bigger changes: one builder agent with a tight brief. No scout, reviewer and fixer chains unless the owner asks for a review.
- Read with grep and line ranges, not whole files. docs/ADDING_A_GAME.md is very long: grep it.
- While working, run targeted vitest and only the e2e specs the change touches. Run `npm run check` and the full e2e suite once, right before pushing.
- Wait for long runs with one background command that reports when it exits. No sleep or poll loops, no periodic check-ins or monitors with nothing to watch.
- Screenshots: only what changed, a handful, each looked at once. Don't send screenshots to the owner.
- Keep one or two changes in flight at a time.
- Superpowers is installed; these rules decide when it is worth its cost. Always: `systematic-debugging` for a failing test or bug, `verification-before-completion` before saying anything is done or pushed. For a big new feature or game only: `brainstorming`, then `writing-plans`, then one builder. Skip brainstorming, plans and `subagent-driven-development` for polish and small asks.

## House rules

- Push straight to main: no pull requests, no force-push.
- Fix root causes. Tests change to the new truth; never loosen, skip or retry them, and never lengthen a timeout to get green.
- Player-facing copy: no em dashes, curly apostrophes, no single word left alone on a line.
- Never run `playwright install`; Chromium is preinstalled.
