# SpeedX — rules for working on this game

SpeedX is a night street-racing game: Three.js, Vite, plain ES modules, no framework.
`README.md` explains where everything lives. Read it before a big change.

## The two rules that always apply

1. **Keep this app organized so a beginner can read it. Before writing anything new, check if it already exists.**
   - Look for a helper, a material, a library object, a UI pattern or a data file that already does the job, and use it.
   - One file = one job, with a plain-words comment block at the top saying what it is for.
   - Numbers a person may want to tune go in `src/config.js` or in the content files under `public/content/`, with a comment.
   - Content (cars, maps, parts, the career's prices and drivers) is data in `public/content/`, not code.

2. **The look of the game is settled — models, UI, mood. New things must be consistent with it and fit in.**
   - Always night, photo-real and cinematic, effects kept moderate (nothing blown out).
   - UI: the same dark panels, monospace text, green `#57ff9a` / amber `#ffd166` / cyan `#59d7e6` accents, the same card and button styles (`src/ui/style.css`).
   - New buildings and props follow the same specification as the ones already in `src/world/library.js`.

## Other standing notes

- Everything shown to the player is in English; speeds are in **km/h**.
- Skills for adding content live in `.claude/skills/` (car, map, tuning parts, Blacklist driver). Use them.
- After changing content run `node tools/check-content.mjs`.
- Commit and push only when asked.
