# FAQ

- [Setup](#setup)
- [Updates and caching](#updates-and-caching)
- [Data](#data)
- [Looks](#looks)
- [Security and limits](#security-and-limits)

## Setup

### Where should the workflow live?

In your **profile repository**, the public repository named exactly like your username (for example `octocat/octocat`). GitHub shows its README on your profile. The quickest start is the [template](https://github.com/chethandvg/profilescape-template/generate), which already contains the workflow and the markers.

### The run fails with "Resource not accessible by integration" or a 403

The workflow token cannot write to the repository. Add this to the workflow (or the job):

```yaml
permissions:
  contents: write
```

If it still fails, an organisation or repository setting may cap the token at read-only: check **Settings → Actions → General → Workflow permissions**.

### The run succeeded, but my README did not change

- Is the `readme` input set? Without it, Profilescape only publishes the images and shows the markup in the job summary.
- Does the file contain both markers, start before end? The run log shows a warning when they are missing or out of order.

  ```md
  <!-- profilescape:start -->
  <!-- profilescape:end -->
  ```

- Is the path right? `readme` is relative to the repository root and case-sensitive (`README.md` is not `readme.md`).

### Can I use it in a private repository?

The action runs, but visitors cannot see the images: they are served from a branch of that repository, and raw files of a private repository need authentication. The run log warns about this. Run Profilescape in a public repository, such as your profile repository. A private profile repository is not shown on your profile anyway.

### Can I fork the template instead of using it?

Use **Use this template** rather than **Fork**. GitHub does not run scheduled workflows in forks until you enable Actions there, and a fork is tied to its upstream. A repository created from the template is your own from the start.

### Can I edit the markup between the markers?

Anything between the markers is replaced on every run. To lay the cards out yourself, leave out the `readme` input, keep the images on the output branch, and reference them directly anywhere in your README:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/octocat/octocat/profilescape-output/3d-dark.svg">
  <img alt="3D contribution landscape" src="https://raw.githubusercontent.com/octocat/octocat/profilescape-output/3d-light.svg" width="100%">
</picture>
```

File names stay the same from run to run, so the links keep working. The job summary of each run shows the markup for every card.

### Can I render someone else's cards, or an organisation's?

Set `username` to any GitHub user; their public data is readable with the default token. Organisation accounts are not supported: Profilescape renders user profiles.

### How do I remove Profilescape?

Delete the workflow file, the marker block in your README and the `profilescape-output` branch.

## Updates and caching

### My cards are not updating

1. **Check the run.** Open the **Actions** tab: did the latest run succeed? The job summary lists every file it published.
2. **Wait a few minutes and refresh.** GitHub serves README images through its image proxy (camo), and both the proxy and `raw.githubusercontent.com` cache files for a few minutes. Your browser may cache them too: try a hard refresh or a private window.
3. **Check the schedule.** GitHub disables scheduled workflows in public repositories without activity for 60 days. If the workflow shows as disabled, enable it again in the **Actions** tab, or run it by hand with **Run workflow**.

### Why does Profilescape publish to a separate branch?

To keep the images out of your history. The `profilescape-output` branch always holds a single commit with exactly the latest files, and nothing is committed at all when the output did not change. Generated images never land in your default branch, never conflict with your own edits, and publishing them is not blocked by branch protection on your default branch.

The `readme` input is the exception: it commits the README to your default branch whenever the markup between the markers changes. The image links stay the same, but the alt text of the stats, 3D, grid and languages cards states live numbers (such as your contribution total) for screen readers, so on an active account expect a small `chore: update profilescape cards [skip ci]` commit most days. That commit is subject to branch protection like any other. For no commits on your default branch at all, leave `readme` empty and reference the images yourself, as shown in [Can I edit the markup between the markers?](#can-i-edit-the-markup-between-the-markers)

Prefer the images in your default branch? Set `publish: none` and commit `output_dir` yourself; see [configuration.md](configuration.md#outputs).

### Can I split the cards across several steps or workflows?

Better not: list every card in the `cards` input of one step. Each run replaces the whole output branch, and a README has one marker block, so two steps or workflows that share a `branch` delete each other's images, and two that both set `readme` overwrite each other's markup. If you need them separate (for example two single-purpose actions), give each its own `branch` and set `readme` on one of them only; place the other one's images yourself with the markup from its job summary.

## Data

### My private contributions are missing

The default workflow token only sees public activity. Two options, which work well together:

- Turn on **Include private contributions on my profile** in your GitHub profile settings. The contribution calendar then counts private contributions anonymously, for every token.
- Pass a read-only personal access token as `token`, so private repositories also count towards languages and statistics. [Step-by-step instructions](configuration.md#private-contributions).

### Why are my forks missing?

Statistics and languages use repositories you own that are not forks, so other people's code does not count as yours. Repo cards show your pinned repositories as they are (forks, archived repositories and other people's repositories included), then fill up with your most starred repositories, which skips forks and archived repositories. To show a fork (or anyone's repository) as a repo card, pin it on your profile or list it with the `repos` input, for example `repos: my-fork,owner/name`.

### A private repository shows up on a repo card

Repo cards never pick private repositories automatically; one only appears when you list it in `repos` and the token can read it. Remove it from `repos`, or set `include_private: false` to exclude private repositories everywhere.

### The numbers differ from my profile page

Stats cover the **last 12 months** as GitHub's API reports them, so pick the same range when you compare. Private contributions only count as far as the token (and your profile setting) allow, and `exclude_repos` and `hide_languages` change what is counted. All-time totals and the longest streak need `history: full`, the default.

### Why is my commit count much lower than my contributions?

GitHub reports commits, pull requests, issues and reviews only for contributions it can itemise. Private contributions you have chosen to show on your profile are counted in the total but arrive as an anonymous "restricted" number, so they cannot be split by type. The stats card shows both figures exactly as the API returns them.

### How are languages weighted?

By default, each repository's language mix is weighted by the commits you made there in the last 12 months, so the languages you actually work in rise to the top and a large vendored file cannot dominate. `"weighting": "bytes"` on the languages card switches to raw code size. `hide_languages` removes languages from all language data.

## Looks

### Why does the text look slightly different on my phone or another OS?

README images are SVGs displayed in an `<img>`, which cannot load web fonts or any other external resource. Profilescape therefore uses each system's own fonts (San Francisco on Apple devices, Segoe UI on Windows, and so on) and lays out text conservatively so it fits with all of them. Custom fonts are not possible in README images.

### Do the animations bother anyone?

Animations are subtle and pure CSS. Most cards animate once as they load; the hero banner keeps a gentle ambient glow, a pulsing status dot and a blinking cursor, and the grid loops its wave (set `"loop": false` to play it once). Visitors whose system asks for reduced motion get the static final frame, which is always the complete card, and so does anything that renders the SVG as a still image. Set `animate: false` to turn animations off for everyone.

### Dark and light switching does not work

GitHub picks the variant with a `<picture>` element that follows your **GitHub** appearance setting (or your system's, if GitHub is set to sync with it). Places that ignore `<picture>`, such as some mobile apps and package registries, show the light variant. To use one variant everywhere, set `modes: dark` or `modes: light`.

### Can I change colours without making a new theme?

Yes: override any colour token in the config JSON with `colors`, `darkColors` and `lightColors`. See [Colours](configuration.md#colours) and [themes.md](themes.md).

## Security and limits

### Will I hit rate limits?

Not in practice. Each run makes a handful of GitHub API requests with your own token: the profile, your repositories, one contribution-calendar request per year of history, and one per repository listed in `repos`. A daily run is far below GitHub's limits, and there is no shared pool for other users to exhaust. `history: year` makes runs even lighter.

### What can the action do with my tokens?

`token` is only used to read your profile from the GitHub API. `github_token` (the workflow token by default) is only used to write the output branch and, if `readme` is set, that README, in the repository running the workflow. There is no Profilescape server, no analytics and no telemetry. Pin the action to a commit SHA for extra safety; see [SECURITY.md](../SECURITY.md).

### Does it work on GitHub Enterprise Server?

Yes. It follows the runner's API and server URLs automatically; see [configuration.md](configuration.md#github-enterprise-server).

---

Still stuck? Ask in [Discussions](https://github.com/chethandvg/profilescape/discussions) or [open an issue](https://github.com/chethandvg/profilescape/issues/new/choose).
