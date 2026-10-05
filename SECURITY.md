# Security policy

Profilescape runs inside your GitHub workflows with access to tokens, so we take security reports seriously and appreciate responsible disclosure.

## Supported versions

| Version | Supported |
| --- | --- |
| `v1.x` (latest minor and patch releases) | Yes |
| Previous major, after a new major ships | Security fixes for 6 months |
| Pre-releases and unreleased commits on `main` | No |

Fixes ship as a new patch release, and the moving `v1` tag (plus the matching tag of every single-purpose mirror such as `profilescape-3d`) is updated to it.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for security problems.**

Report privately through GitHub's private vulnerability reporting: [open a draft security advisory](https://github.com/chethandvg/profilescape/security/advisories/new). Include what you found, how to reproduce it, and the impact you expect. We aim to send:

- an acknowledgement within **3 working days**;
- an assessment and a fix plan within **10 working days**;
- a coordinated release, a published advisory, and credit if you would like it.

The single-purpose action repositories (`profilescape-3d`, `profilescape-stats` and the others) and the profile template are built from this repository, so report issues in any of them here.

## How Profilescape handles your tokens

- **Reading.** The `token` input is used only to read data from the GitHub API: your profile, contribution calendar, repositories and languages. Profilescape never writes anything with it.
- **Writing.** The `github_token` input (the workflow's own `GITHUB_TOKEN` by default) is used only to write to the repository running the workflow: the output branch (`profilescape-output` by default) and, when the `readme` input is set, that README. It never writes anywhere else.
- **No third parties.** Profilescape talks to the GitHub API only. There is no Profilescape server, no analytics and no telemetry; rendering happens on the runner.
- **No leaks into output.** Tokens are never logged or embedded in the generated SVG files, and the runner masks secrets in logs. Set `include_private: false` if your cards should use public data only.

## Hardening your workflow

- **Pin to a commit SHA.** Tags can move; commits cannot. Pin the action to the full commit SHA of a release and keep the version in a comment so Dependabot can update it:

  ```yaml
  - uses: chethandvg/profilescape@<full-commit-sha> # v1.2.3
  ```

- **Grant the least permissions.** The job only needs `contents: write`. Declare it at job level and nothing else.
- **Use a read-only token for private data.** If you include private contributions, create a fine-grained personal access token with **read-only** repository access, store it as an encrypted secret (for example `PROFILESCAPE_TOKEN`) and pass it as `token`. Leave `github_token` on the default workflow token so the personal token can never write.
- **Keep the output branch separate.** Publishing to a dedicated branch keeps generated SVG commits out of your main history and out of branch protection rules. If you set `readme`, your README on the default branch is updated whenever the card markup changes (often daily); leave `readme` empty to avoid commits there.
- **Review what you run.** The bundled `dist/index.mjs` is built in CI from the sources in this repository, and CI fails if the committed bundle differs from a fresh build.
