# Contributing to a small world

Thanks for taking the time to contribute. This is a small, opinionated project — the quickest way in is to read [`CLAUDE.md`](CLAUDE.md) first; it captures the architecture, conventions, and the "cute by design" constraints that every change has to respect.

## Development environment

You need Node.js and npm. Runtime dependencies (three.js, simplex-noise) are installed via npm and bundled/tree-shaken by Vite — nothing is loaded from a CDN.

```sh
npm install       # install runtime + dev dependencies
make dev          # Vite dev server with HMR in the foreground, http://localhost:2001
make dev-start    # same server in the background
make dev-stop     # stop the background server
make dev-restart  # restart the background server
```

Edits to `main.js`, `src/*.js`, `style.css`, and `index.html` are picked up by Vite HMR without a full reload when possible.

## Verification before a PR

Before opening a pull request, run the full check and make sure it passes end to end:

```sh
make checkall     # all JS/Python tests + ESLint + production build
make lint         # ESLint over main.js and src/ (subset of checkall)
make build        # optimized production bundle into dist/
```

`make checkall` is the source of truth — it runs lint, tests, and the production build together. If any step fails, fix it before pushing.

## Versioning and releases

The app version lives in `package.json` (`"version"` field). CI reads it and injects it into the build (it shows up as "vol. X.Y.Z" in the header eyebrow), so the deployed site always reflects the committed version.

**Always bump `version` in `package.json` before pushing to `main`.** Follow [Semantic Versioning](https://semver.org/):

- **patch** — bug fixes, small tweaks
- **minor** — new features, new biomes, new creatures
- **major** — breaking changes, major reworks

Pair every version bump with a matching entry in [`CHANGELOG.md`](CHANGELOG.md) (Added / Changed / Fixed / Verified sections, newest at the top).

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

Examples from this repo's history:

- `feat(postfx): mip-chain bloom`
- `fix(ui): mobile fly controls`
- `feat(catalog): load biome entries with current seed`
- `chore(release): 1.5.7`

The release commit that bumps `package.json` is `chore(release): X.Y.Z`.

## Pull request process

1. Branch from `main`.
2. Make your change. Touch only what your change requires — match the existing style even if you'd write it differently.
3. Run `make checkall`. Fix every error.
4. Bump `package.json` `version` if your change is user-visible (and add a `CHANGELOG.md` entry).
5. Commit with a Conventional Commits message.
6. Open the PR against `main`. Pushing to `main` triggers the GitHub Actions workflow that runs `npm ci && npm run build` and deploys `dist/` to GitHub Pages, so the live site at https://small-world.pardev.net/ reflects merged work.

## Design constraints

Keep it **cute**. From `CLAUDE.md`:

- Big eyes, small bodies. Don't shrink creatures' eyes or push toward realistic or menacing proportions.
- Rounded, blobby silhouettes (jittered icospheres, chunky stylized flora) — never photorealistic or sharp.
- Smooth, easeful motion (soft acceleration, slight overshoot, idle breathing) — never linear or twitchy.
- Saturated but soft palettes; ACES tone mapping with mild exposure and heavy fog — no harsh contrast or neon.

If a change would make something look scary, sharp, realistic, or twitchy, it's wrong for this project even if it's technically nicer. See the "Vibe" section of [`CLAUDE.md`](CLAUDE.md) for the full rationale.

## License

By contributing you agree your contributions are licensed MIT, matching the project's [`LICENSE`](LICENSE). Copyright © 2026 Paul Robello.
