# Contributing to Profilescape

Thanks for wanting to make GitHub profiles more beautiful. Bug fixes, new themes, new cards, docs and ideas are all welcome. This guide gets you from clone to pull request.

- **Questions and ideas:** [Discussions](https://github.com/chethandvg/profilescape/discussions)
- **Bugs and feature requests:** [issue forms](https://github.com/chethandvg/profilescape/issues/new/choose)
- **Security problems:** [private advisory](https://github.com/chethandvg/profilescape/security/advisories/new), never a public issue (see [SECURITY.md](SECURITY.md))

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). There is no CLA and no DCO sign-off: by opening a pull request you agree that your contribution is licensed under the [MIT License](LICENSE).

## Setup

You need **Node.js 24** (22.18 or newer also works) and npm. There are no runtime dependencies, and TypeScript runs directly through Node's type stripping, so there is no build step during development.

```sh
git clone https://github.com/chethandvg/profilescape.git
cd profilescape
npm ci
npm run check   # typecheck, test, build
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type-checks everything with TypeScript (`tsc --noEmit`). |
| `npm test` | Runs every `*.test.ts` with Node's built-in test runner. |
| `npm run build` | Bundles the Action and CLI into `dist/` with esbuild. |
| `npm run check` | All three of the above. CI also fails when `dist/`, the generated Action files or the gallery images are out of date. |
| `npm run preview` | Renders cards to `preview/` as SVG and PNG (see below). |
| `npm run gallery` | Regenerates the README and Marketplace images in `docs/images/` and the option tables in the docs. Run it after any change to card output; CI runs `node scripts/gallery.ts --check`. |
| `npm run site` | Builds the website and playground into `site/dist/`. |
| `npm run gen:icons` | Regenerates `src/cards/icons.generated.ts` from `simple-icons`. |
| `npm run gen:actions` | Regenerates `action.yml` and `mirrors/` from `actions/manifest.json`. |

Run a single test file with `node --test src/cards/stats.test.ts`.

## Project rules

These keep Profilescape fast, safe and identical everywhere it runs. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the reasoning.

- **Browser-safe core.** Everything in `src/cards/` and `src/core/` (except `src/core/github.ts`) also runs in the website playground: no `node:` imports, no `process`, no `Buffer`.
- **Zero runtime dependencies.** Do not add packages to `dependencies`. Dev dependencies need a good reason.
- **Deterministic output.** Same input, same SVG, byte for byte. Use `ctx.now`, never `Date.now()`, `new Date()` or `Math.random()`.
- **Erasable TypeScript only.** No enums, namespaces, parameter properties or decorators, and relative imports include the `.ts` extension.
- **Escape everything.** Pass all user-provided text through `esc()` and keep it inside the card with `fit()` or `wrap()`.
- **Theme colours only.** Use the tokens from `ctx.palette`, and `contribRamp()` for contribution intensity. Never hard-code a theme colour.
- **Graceful empty states.** Every card must look intentional for a brand-new account (`emptyProfile()`): no `NaN`, `undefined` or crashes.
- **Commit `dist/`.** GitHub runs the bundled `dist/index.mjs` straight from the repository, so run `npm run build` and commit the result. CI fails when it is stale.

## Previewing your changes

Visual changes need visual review. `scripts/preview.ts` renders cards with demo data and writes SVG plus PNG files you can open in any image viewer:

```sh
node scripts/preview.ts --card stats --theme aurora                # demo data, dark and light
node scripts/preview.ts --card stats --theme aurora --data empty   # brand-new account
node scripts/preview.ts --card repos --opts '{"layout":"detail"}'  # card options
node scripts/preview.ts --card all --theme all --no-png            # everything, SVG only
GH_TOKEN=<token> node scripts/preview.ts --card all --user octocat # real data
```

Files land in `preview/<card>/<theme>/`. PNGs show the final frame (CSS animations are not rendered), so also open the SVG in a browser to check motion. Before you open a pull request, look at **dark and light**, **demo and empty** data, and long or unusual text: nothing should overlap, clip or overflow.

## Adding a theme

1. Add a `Theme` object to `PRESETS` in [`src/core/theme-presets.ts`](src/core/theme-presets.ts) with a lowercase `id`, a display `label`, and complete `dark` and `light` palettes. The `Palette` type in [`src/core/types.ts`](src/core/types.ts) documents every token.
2. Check contrast against `panel`: `text` at least 7:1, `muted` 4.5:1, `faint` 2.4:1 and both accents 3:1 (the full list is in [docs/themes.md](docs/themes.md#propose-a-theme)). `npm test` checks every preset, and `contrast()` in `src/core/svg.ts` computes the ratio.
3. Preview every card with it: `node scripts/preview.ts --card all --theme <id>`, and also with `--data empty`.
4. Run `npm run gallery` to add the theme to the docs images (CI fails when they are out of date), then `npm run check`.
5. Open a pull request with dark and light screenshots. If the palette is based on someone else's work, link it and make sure its licence allows reuse.

Not into code? Propose a palette with the [new theme form](https://github.com/chethandvg/profilescape/issues/new?template=theme_proposal.yml) instead.

## Adding a card

1. Open an issue or discussion first so we can agree on the design.
2. Add the id to `CARD_IDS` in [`src/core/types.ts`](src/core/types.ts).
3. Create `src/cards/<name>.ts` exporting `card: CardDefinition` with an `id`, `title`, `description`, documented `options` and a pure `render(ctx)` that returns `CardImage[]`. Wrap the SVG with `shell()` and use `label()` for the header so it matches the other cards.
4. Register it in [`src/cards/registry.ts`](src/cards/registry.ts) and in the `FILES` map of [`scripts/preview.ts`](scripts/preview.ts).
5. Add `src/cards/<name>.test.ts` covering demo and empty data, both modes, hostile text (for example a name like `<script>&"'`), determinism, and the key values appearing in the SVG.
6. Run `npm run gen:actions` (the card list in the Action inputs is generated), `npm run build` and `npm run check`, then preview it as described above.

## Changing the Action inputs or the mirrors

`action.yml` and everything in `mirrors/` are generated. Edit `actionInputs()` in [`scripts/gen-actions.ts`](scripts/gen-actions.ts) (and the matching parser in `src/action/config.ts`) or [`actions/manifest.json`](actions/manifest.json), then run `npm run gen:actions`. CI runs `node scripts/gen-actions.ts --check` and fails on drift.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org) so the history and release notes read well:

```text
feat(languages): add a compact donut layout
fix(3d): keep the tallest column inside the card
docs: explain private contributions
chore(deps): bump esbuild
```

Common types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `ci` and `chore`. Use the card id or area as the scope when it helps. Keep pull requests focused: one change per pull request is easier to review and to revert.

## Pull requests

- Fork the repository and branch from `main`.
- Make your change with tests, run `npm run check`, rebuild and commit `dist/`.
- Fill in the pull request template, including screenshots for visual changes.
- CI must be green. A maintainer will review, usually within a few days.

Releases are cut by maintainers; see [docs/RELEASING.md](docs/RELEASING.md) if you are curious how they reach the Marketplace.
