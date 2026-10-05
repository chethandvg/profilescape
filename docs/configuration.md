# Configuration

Profilescape reads its settings from three places, in this order:

1. **Built-in defaults.** Everything works with no configuration at all.
2. **A config JSON** (optional, via the `config` input). Per-card options, colour overrides and the shared settings, in a file you can keep next to your workflow.
3. **Action inputs** in your workflow's `with:` block. These win over the config, with one subtlety explained in [Precedence](#precedence).

- [Inputs](#inputs)
- [Outputs](#outputs)
- [Precedence](#precedence)
- [Config JSON](#config-json)
- [Colours](#colours)
- [Private contributions](#private-contributions)
- [Publishing and the README](#publishing-and-the-readme)
- [GitHub Enterprise Server](#github-enterprise-server)
- [CLI flags](#cli-flags)

## Inputs

Every input is optional. These are the umbrella action's inputs; the [single-purpose actions](../README.md#standalone-actions) accept the same inputs and only change the default of `cards`.

<!-- generated:inputs -->
| Input | Default | Description |
| --- | --- | --- |
| `username` | _empty_ | GitHub username to render cards for. Empty uses the owner of the repository running the workflow. |
| `token` | `${{ github.token }}` | Token used to read profile data from the GitHub API. The default workflow token sees public activity; pass a personal access token (for example `${{ secrets.PROFILESCAPE_TOKEN }}`) to include private repositories and contributions. |
| `cards` | `stats,3d,languages,repos` | Comma-separated cards to render, in README order. Available: `stats`, `languages`, `3d`, `grid`, `repos`, `hero`, `stack`, `socials`. |
| `theme` | `aurora` | Colour theme id, for example `aurora`. Preview every theme in the playground at https://chethandvg.github.io/profilescape. |
| `modes` | `dark,light` | Colour modes to render: `dark`, `light` or both. With both, the README markup follows each viewer's GitHub theme automatically. |
| `animate` | `true` | Add subtle CSS animations. Viewers who prefer reduced motion always get the static final frame. |
| `history` | `full` | Contribution history to fetch: `full` (every year since the account was created) or `year` (the last 12 months, faster). |
| `hide_languages` | _empty_ | Comma-separated languages to leave out of language statistics, for example `HTML,Jupyter Notebook`. |
| `exclude_repos` | _empty_ | Comma-separated repositories (`name` or `owner/name`) to ignore in every card. |
| `include_private` | `true` | Include private repositories the token can read in repository and language statistics. Contribution counts always follow what the token can see, so use the default workflow token for public-only counts. |
| `repos` | _empty_ | Comma-separated repositories for repo cards (`name` or `owner/name`). Empty uses your pinned repositories, then your most starred. |
| `config` | _empty_ | Optional JSON config with per-card options and colour overrides: a path relative to the repository root (requires `actions/checkout`) or inline JSON. |
| `output_dir` | `profilescape` | Workspace directory the SVG files and a ready-to-paste `README-snippet.md` are written to, for use by later steps. |
| `publish` | `branch` | Where to publish the SVG files: `branch` commits them to the output branch (only when something changed), `none` only writes them to `output_dir`. |
| `branch` | `profilescape-output` | Dedicated branch that holds the published SVG files. It is replaced wholesale on every publish (a single commit, so it never bloats your history); Profilescape refuses to overwrite your default branch or any branch it did not create. |
| `commit_message` | `chore: update profilescape cards` | Commit message for the output branch and README updates. |
| `readme` | _empty_ | README to keep up to date, for example `README.md`. The cards are written between `<!-- profilescape:start -->` and `<!-- profilescape:end -->` markers. Empty leaves READMEs untouched. |
| `github_token` | `${{ github.token }}` | Token used to push the output branch and README update to this repository. Needs `contents: write`. |
<!-- /generated:inputs -->

Lists (`cards`, `modes`, `hide_languages`, `exclude_repos`, `repos`) are comma-separated; newlines work too. Booleans accept `true`/`false`, `yes`/`no`, `on`/`off` and `1`/`0`. `modes` also accepts `both`, and `history` accepts `all` (for `full`) and `1y` (for `year`).

## Outputs

<!-- generated:outputs -->
| Output | Description |
| --- | --- |
| `files` | JSON array of the files written to `output_dir`, relative to the workspace: every SVG plus `README-snippet.md`. |
| `markup` | Ready-to-paste README HTML for the rendered cards, switching between dark and light with the viewer's theme. |
| `base_url` | Where the cards are served from: the raw URL of the output branch with `publish: branch`, otherwise `output_dir`. |
<!-- /generated:outputs -->

For example, to commit the SVGs to your default branch yourself instead of using the output branch:

```yaml
    steps:
      - uses: actions/checkout@v7
      - id: cards
        uses: chethandvg/profilescape@v1
        with:
          publish: none
          output_dir: assets/profilescape
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add assets/profilescape
          git commit -m "chore: update profile cards" || echo "No changes"
          git push
```

With `publish: none` the markup in `README-snippet.md` and the `markup` output points at `output_dir`, as a path relative to the repository root.

## Precedence

**Built-in defaults < config JSON < inputs.** Nine settings can be set both as an input and in the config JSON:

| Input | Config key |
| --- | --- |
| `cards` | `cards` |
| `theme` | `theme` |
| `modes` | `modes` |
| `animate` | `animate` |
| `history` | `history` |
| `hide_languages` | `hideLanguages` |
| `exclude_repos` | `excludeRepos` |
| `include_private` | `includePrivate` |
| `repos` | `repos` |

For each of them, the action uses the input if it is **set**, otherwise the config value, otherwise the built-in default.

> [!IMPORTANT]
> The Actions runner always passes every input to the action, filling in the `action.yml` default for the ones you did not write. Profilescape therefore treats an input as **set** only when it is non-empty **and differs from its default** (ignoring case and whitespace). An input you write with its default value behaves exactly as if you had left it out.
>
> So `theme: aurora` in the workflow does **not** override `"theme": "dracula"` in the config, because `aurora` is the default. To get the default back, remove the key from the config instead.

Everything else lives in exactly one place:

- **Inputs only:** `username`, `token`, `github_token`, `config`, `output_dir`, `publish`, `branch`, `commit_message` and `readme`. These describe how and where the action runs, not what the cards look like. A `username` in the config JSON is ignored with a warning.
- **Config JSON only:** `colors`, `darkColors`, `lightColors` and the per-card `options`.

The resolved configuration, including where each value came from (`(input)` or `(config)`), is printed in the **Configuration** group of the action log.

## Config JSON

Pass a path relative to the repository root, which needs `actions/checkout` first:

```yaml
    steps:
      - uses: actions/checkout@v7
      - uses: chethandvg/profilescape@v1
        with:
          config: .github/profilescape.json
          readme: README.md
```

or inline JSON (anything starting with `{`), which needs no checkout:

```yaml
      - uses: chethandvg/profilescape@v1
        with:
          readme: README.md
          config: |
            { "theme": "nord", "options": { "languages": { "layout": "donut" } } }
```

The file is forgiving: `//` and `/* */` comments and trailing commas are allowed, keys may be written in `camelCase`, `snake_case` or `kebab-case` (`hideLanguages`, `hide_languages` and `hide-languages` are the same key), and an unknown key produces a warning with a "did you mean" hint instead of failing. Syntax errors point at the exact line and column.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `$schema` | string | | Ignored; allowed so editors can attach a schema. |
| `theme` | string | `"aurora"` | Theme id; see [themes](themes.md). An unknown id warns and falls back to `aurora`. |
| `cards` | list | `["stats", "3d", "languages", "repos"]` | Cards in README order: `stats`, `languages`, `3d`, `grid`, `repos`, `hero`, `stack`, `socials`, or `"all"`. Aliases such as `landscape`, `banner` and `heatmap` work too. |
| `modes` | list | `["dark", "light"]` | `"dark"`, `"light"` or both (`"both"` also works). |
| `animate` | boolean | `true` | Subtle CSS animations. Reduced-motion viewers always get the static frame. |
| `history` | string | `"full"` | `"full"` fetches every year since the account was created (all-time totals, longest streak); `"year"` only the last 12 months. |
| `hideLanguages` | list | `[]` | Languages to leave out of language statistics. |
| `excludeRepos` | list | `[]` | Repositories (`name` or `owner/name`) to ignore everywhere. |
| `includePrivate` | boolean | `true` | Use private repositories the token can read in aggregated statistics. |
| `repos` | list | `[]` | Repositories for repo cards. Empty means pinned, then most starred. |
| `colors` | object | `{}` | Colour overrides for both modes; see [Colours](#colours). |
| `darkColors` | object | `{}` | Overrides for dark mode only, applied after `colors`. |
| `lightColors` | object | `{}` | Overrides for light mode only, applied after `colors`. |
| `options` | object | `{}` | Per-card options keyed by card id; every option is documented in [cards.md](cards.md). |

A complete example:

```jsonc
{
  // Shared settings (inputs that are set explicitly still win).
  "theme": "catppuccin",
  "cards": ["hero", "stats", "3d", "languages", "repos", "stack", "socials"],
  "hideLanguages": ["HTML", "Jupyter Notebook"],
  "excludeRepos": ["dotfiles"],

  // Colours: both modes, then per mode.
  "colors": { "accentA": "#F5A97F" },
  "darkColors": { "panel": "#11111B" },

  // Per-card options.
  "options": {
    "hero": { "role": "Backend engineer", "codeLanguage": "go", "status": "none" },
    "stats": { "metrics": ["currentStreak", "longestStreak", "commits", "pullRequests", "reviews", "allTime"] },
    "3d": { "weeks": 52, "scale": "sqrt" },
    "languages": { "weighting": "bytes", "top": 8 },
    "repos": { "count": 4 },
    "stack": { "icons": ["go", "postgresql", "redis", "docker", "k8s", "terraform"] },
    "socials": { "links": { "linkedin": "your-handle", "custom": [{ "label": "Blog", "url": "https://example.com/blog" }] } }
  }
}
```

## Colours

Every theme defines the same set of colour tokens for dark and light mode. Overrides are applied in this order: the theme's palette for the mode, then `colors`, then `darkColors` or `lightColors`.

| Token | Used for |
| --- | --- |
| `bg` | Page-level background behind full-bleed art such as the hero banner. |
| `panel` | Card surface. |
| `panelAlt` | Raised surfaces: metric tiles, the code editor, detail-card tiles. |
| `border` | Card and tile outlines. |
| `text` | Primary text. |
| `muted` | Secondary text. |
| `faint` | Tertiary text: axis labels, separators, hints. |
| `accentA` | Primary accent; gradients run from `accentA` to `accentB`. |
| `accentB` | Secondary accent and labels. |
| `success` | The hero status dot. |
| `chipBg` | Chips and pills. |
| `empty` | Days without contributions. |
| `grid` | Decorative grid lines (drawn at `gridOpacity`). |
| `gridOpacity` | Number from 0 to 1. |
| `glowOpacity` | Strength of the soft glows, from 0 to 1. |
| `syntax` | Object with `keyword`, `type`, `string`, `property`, `number`, `punctuation` and `comment`: the hero code editor. |

Colours are hex: `#RGB`, `#RRGGBB` or `#RRGGBBAA`, with or without the `#`. An invalid colour stops the run with a clear message; an unknown token is ignored with a warning.

Contribution colours are not separate tokens: every contribution visual (3D landscape, grid, stats chart) uses the same five-step scale from `empty` through `accentA` to a light (dark mode) or deep (light mode) shade of `accentB`. Changing those three tokens recolours all of them consistently.

```json
{
  "theme": "monochrome",
  "colors": { "accentA": "#E11D48", "accentB": "#FB7185" },
  "lightColors": { "accentB": "#BE123C" }
}
```

## Private contributions

Out of the box Profilescape uses the workflow's `GITHUB_TOKEN`, which can only see public activity. If you have turned on **Include private contributions on my profile** in your GitHub profile settings, the contribution calendar already counts your private contributions anonymously. A personal access token goes further: private repositories then count towards your languages, commit weighting and repository statistics.

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - **Resource owner:** your account.
   - **Expiration:** your choice. When it expires the run fails with a clear message; renew the token and update the secret.
   - **Repository access:** All repositories.
   - **Repository permissions:** **Contents: Read-only** and **Metadata: Read-only** (Metadata is selected automatically). Nothing else, and no account permissions.
2. In your profile repository, open **Settings → Secrets and variables → Actions** and add a repository secret named `PROFILESCAPE_TOKEN` with the token.
3. Pass it as `token`:

   ```yaml
         - uses: chethandvg/profilescape@v1
           with:
             token: ${{ secrets.PROFILESCAPE_TOKEN }}
             readme: README.md
   ```

Leave `github_token` on its default, the workflow token. Writes then always use the short-lived workflow token, and the personal token stays read-only. A fine-grained token can only read repositories of one resource owner; private work in organisation repositories is counted only as far as GitHub exposes it to that token.

To use the token when it exists and fall back to the workflow token when it does not (handy in templates), write `token: ${{ secrets.PROFILESCAPE_TOKEN || github.token }}`.

Set `include_private: false` to keep private repositories out of the statistics even when the token can read them. Repo cards never pick private repositories automatically; one only appears if you list it in `repos` (and `include_private` is on).

## Publishing and the README

With the default `publish: branch`, the action writes the SVGs, a `README-snippet.md` and a small landing `README.md` to the `profilescape-output` branch using the GitHub API (no checkout and no git binary needed). The branch always holds a **single commit** with exactly the files of the latest run, and nothing is committed when the output did not change, so it never bloats your history.

Put every card in **one step** with a `cards` list. Because the branch is replaced on every run, two workflows or steps that publish different cards to the same `branch` delete each other's images, and the single marker block in a README can only hold the markup of one of them. If you need separate steps (for example two [single-purpose actions](../README.md#standalone-actions)), give each its own `branch` and set `readme` on one of them only; place the other step's images yourself with the markup from its job summary or `markup` output.

With `readme: README.md`, the action rewrites only the text between these markers in that file and leaves everything else alone:

```md
<!-- profilescape:start -->
<!-- profilescape:end -->
```

If the markers are missing, the README is not changed and the run ends with a warning that explains how to add them. The markup uses `<picture>` elements, so each visitor sees the variant that matches their GitHub theme. Half-width images (compact repo cards, the compact languages card) are paired in a two-column table, and social badges flow side by side.

The README is committed to your default branch (through the Contents API, with `github_token`) whenever the markup between the markers changes. The image URLs stay the same, but the alt text of the stats, 3D, grid and languages cards includes live numbers such as your contribution total, so screen-reader users hear the same figures as everyone else. On an active account that means a small `chore: update profilescape cards [skip ci]` commit most days. Branch protection on the default branch applies to that commit. For no commits on your default branch at all, leave `readme` empty and reference the images yourself, as shown in the [FAQ](faq.md#can-i-edit-the-markup-between-the-markers).

The job needs `permissions: contents: write`. Images on the output branch are served from `raw.githubusercontent.com`, so the repository must be public for visitors to see them. That is already the case for a profile repository (`<username>/<username>`): GitHub only shows its README on your profile while it is public.

## GitHub Enterprise Server

Profilescape follows the runner's `GITHUB_API_URL`, `GITHUB_GRAPHQL_URL` and `GITHUB_SERVER_URL`, so the same workflow works on GitHub Enterprise Server without extra inputs. There, published images are served from `<server>/<owner>/<repo>/raw/<branch>`, which visitors can only open if they can read the repository.

## CLI flags

The CLI accepts the same settings as flags. Unlike action inputs, a flag you pass always wins over the config file, even when it repeats a default.

| Input | CLI flag |
| --- | --- |
| `username` | `--user` (or the first argument) |
| `token` | `--token`, or the `GH_TOKEN` / `GITHUB_TOKEN` environment variable |
| `cards` | `--cards` |
| `theme` | `--theme` |
| `modes` | `--modes` |
| `animate: false` | `--no-animate` |
| `history` | `--history` |
| `hide_languages` | `--hide-languages` |
| `exclude_repos` | `--exclude-repos` |
| `include_private: false` | `--no-private` |
| `repos` | `--repos` |
| `config` | `--config` (a file path) |
| `output_dir` | `--out` |

`--demo` renders the built-in demo profile without a token, and `--base-url` sets the image URL prefix used in `README-snippet.md`. Run `npx github:chethandvg/profilescape --help` for the full list.
