# Architecture

Profilescape turns a GitHub profile into a set of SVG cards. One rendering engine powers three front ends: the GitHub Action, the CLI and the website playground. This page is the map for contributors.

## Data flow

```text
                       GitHub GraphQL API
                              │  token (read-only use)
                              ▼
  src/core/github.ts   fetchProfile()  ──►  ProfileData  ◄──  src/core/fixtures.ts
  (the only module with                       │                (demoProfile, emptyProfile)
   network access)                            ▼
  src/render.ts        renderCards({ data, cards, theme, modes, options, now })
                              │  for each card × mode: card.render(ctx)
                              ▼
  src/cards/*.ts       CardImage[]  { name, alt, svg, link?, layout? }
                              │
                              ▼
  src/render.ts        RenderedFile[]  ──►  readmeMarkup()  ──►  <picture> HTML
                              │
          ┌───────────────────┼──────────────────────┐
          ▼                   ▼                      ▼
  src/action/main.ts    src/cli.ts             site/ (playground)
  publish to a branch,  write files to disk,   render live in the
  update the README     print the markup       browser, copy markup
```

## The core contract

[`src/core/types.ts`](../src/core/types.ts) defines everything the pieces agree on:

- **`ProfileData`**: the normalised profile (calendar, yearly totals, languages, repositories). Cards never call APIs; they only read this.
- **`Palette` and `Theme`**: semantic colour tokens (`panel`, `text`, `muted`, `accentA`, ...) with a dark and a light variant per theme.
- **`CardDefinition`**: `{ id, title, description, options, render(ctx) }`. `render` is a pure function from a `RenderContext` (data, palette, mode, options, `animate`, `now`) to one or more `CardImage`s.
- **`CARD_IDS`**: the list of card ids. The Action inputs, the docs and the manifest validation are generated or checked against it.

Shared helpers live next to it: `svg.ts` (the `shell()` frame, `label()`, escaping, text measurement and truncation, colour maths), `themes.ts` and `theme-presets.ts`, `calendar.ts` (streaks, year windows, level scales), `format.ts`, and `options.ts` (forgiving readers for per-card options).

## Rules that keep it portable

- **Browser-safe.** `src/cards/**` and `src/core/**` (except `github.ts`) import no `node:` modules and touch no `process` or `Buffer`, so the same code runs on the Actions runner, in the CLI and in the browser.
- **Deterministic.** Time comes from `ctx.now` and nothing is random, so the same data always produces the same bytes. That makes tests exact, keeps the output branch from churning, and lets the publisher skip commits when nothing changed.
- **No runtime dependencies.** esbuild bundles each entry point into one file in `dist/`, which is committed because GitHub runs actions straight from the repository. CI rebuilds and fails on any difference.
- **Static first frame.** Animations are CSS only and use `animation-fill-mode: backwards`, so viewers with reduced motion, image proxies and PNG renderers all see the complete card.

## The Action

[`action.yml`](../action.yml) runs `dist/index.mjs` on Node 24. [`src/action/main.ts`](../src/action/main.ts) wires it together:

1. **Configure.** `config.ts` merges built-in defaults, an optional JSON config (file or inline) and the action inputs into a validated `ProfilescapeConfig`, with "did you mean" hints for typos.
2. **Fetch** the profile with `token`.
3. **Render** every requested card in every mode.
4. **Write** the SVGs and a `README-snippet.md` to `output_dir`.
5. **Publish** (`publish: branch`): `publish.ts` uses the Git Data REST API to replace the output branch with a single commit holding exactly the new files, and does nothing when the tree is unchanged. No git binary or checkout is needed.
6. **Update the README** (`readme` input): `readme.ts` rewrites only the text between `<!-- profilescape:start -->` and `<!-- profilescape:end -->` through the Contents API.
7. **Report** the `files`, `markup` and `base_url` outputs and a job summary.

`token` is only ever used to read, and `github_token` only to write to the repository running the workflow.

## Distribution

```text
chethandvg/profilescape  (source, CI, umbrella action, releases)
   │
   │  scripts/gen-actions.ts  reads  actions/manifest.json
   │    ├─ action.yml                     umbrella action
   │    └─ mirrors/<repo>/action.yml      same inputs, different `cards` default
   │       mirrors/<repo>/README.md       Marketplace page
   │
   │  .github/workflows/release.yml  on tag vX.Y.Z
   ├──►  profilescape-3d, -stats, -languages, -repo-cards, -hero, -grid
   │       (action.yml, README.md, LICENSE, dist/index.mjs, SOURCE.md; tags vX.Y.Z and vX)
   └──►  profilescape-template   (contents of template/)
```

Single-purpose mirrors exist for discoverability: each has its own Marketplace listing, but they are generated, never edited by hand, and run the identical bundle. Issues and pull requests always come here. `node scripts/gen-actions.ts --check` and `node scripts/gallery.ts --check` (the README and Marketplace images) run in CI and in the release workflow, and the tests check that the inputs in `action.yml` match what the runtime parses. See [RELEASING.md](RELEASING.md) for the release process.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/core/` | Data model, theming, SVG helpers, GitHub client |
| `src/cards/` | One module per card, plus the registry and generated icons |
| `src/action/` | Action entry point, config resolution, publishing, README updates |
| `src/cli.ts`, `src/render.ts` | CLI and the shared rendering entry point |
| `scripts/` | Build, preview, gallery, site, icon and action generators |
| `site/` | Website and playground sources |
| `dist/` | Committed bundles (`index.mjs` for the Action, `cli.mjs` for the CLI) |
| `actions/`, `mirrors/` | Mirror manifest and the generated mirror files |
| `template/` | Contents of the profile template repository |
| `docs/` | These docs and the gallery images |
| `.github/` | CI, release, Pages, CodeQL and self-test workflows, issue forms |
