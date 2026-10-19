# GH Extensions

A small, dependency-free browser extension for focused GitHub comparisons and pull request reviews. One codebase, with Manifest V3 packages for Chrome and Firefox.

![Compare preview using synthetic data](docs/compare-preview.png)

## Compare releases without the noise

On a `github.com/OWNER/REPO/compare/A...B` page, the **GH Extensions** toolbar adds:

- **Load A → B**: fetch every page of commits from the GitHub API. Enable **Merge / squash commits only** to omit intermediate work commits.
- **Check reverse B → A**: list commits reachable from A but absent from B, with a link to the reverse file diff. Useful for investigating changes that may have been left behind.
- Complete counts, commit links, and explicit errors when GitHub access, rate limits, or pagination prevent a complete result.

The complete list is rendered in the extension panel above GitHub’s native compare view. GitHub’s original commits and file diff remain available below. No page-by-page clicking is needed. Branch names are resolved to commit SHAs before pagination so a moving branch cannot mix multiple comparisons.

Merge commits are identified by multiple parents. Single-parent integration commits are identified by a merged PR whose recorded `merge_commit_sha` equals the commit SHA, even if the commit title has been edited. GitHub also records the final rebased commit in this field, so it cannot reliably distinguish every squash merge from a rebase merge. These entries are labeled **squash / PR integration**. Ordinary commits associated with a PR are not included unless they match its recorded integration SHA.

Reverse comparison checks Git ancestry. A cherry-picked, squashed, or rebased equivalent can have a different SHA; a reverse-only commit is a candidate to investigate, not proof that its code is missing. This extension does not compute patch equivalence.

## Review the conversations you need

On a PR’s **Conversation** and **Files changed** tabs (including both `/files` and `/changes`):

- **Only these authors**: show threads started by the entered usernames, including all replies from everyone. Replying to somebody else’s thread does not make that thread yours.
- **Hide these authors**: hide their threads, standalone comments, and their individual replies inside other threads.
- **Only mine**: use the signed-in GitHub username as the include filter.
- **Reset**: restore every discussion.

Usernames are case-insensitive and may be separated by commas or whitespace. The filter is saved locally and reused when opening another PR or switching tabs. Already-open tabs refresh their filter on navigation or when Apply is used. The opening PR description and comment editors stay visible. Filtering changes only your local view; nothing is deleted or submitted to GitHub.

Both classic and current React review threads are supported. New comments loaded by GitHub are filtered automatically. Load or expand additional discussions as usual; the extension does not fetch hidden historical comments or bypass GitHub’s lazy loading. Unrecognized layouts remain visible, and the toolbar reports how many discussions it recognized. GitHub UI changes may require updates to `extension/review.js`.

![Review focus preview using synthetic data](docs/review-preview.png)

## Install

Download the browser ZIP from [Releases](https://github.com/udayabharathi-t/gh-extensions/releases), or build from source:

```sh
npm ci
npm run build
```

### Chrome

1. Extract `gh-extensions-chrome.zip`, or use `dist/chrome` from a build.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted directory containing `manifest.json`.
4. Reload any GitHub tabs that were already open.

Requires Chrome 120 or later. The ZIP is an unpacked developer build, not a Chrome Web Store installation.

### Firefox

1. Extract `gh-extensions-firefox.zip`, or use `dist/firefox` from a build.
2. Open `about:debugging#/runtime/this-firefox` and choose **Load Temporary Add-on**.
3. Select `manifest.json` in that directory.
4. Reload any GitHub tabs that were already open.

Requires Firefox 140 or later. Temporary add-ons are removed when Firefox restarts. A persistent Firefox installation needs Mozilla signing and an XPI; the ZIP here is an unsigned development package. Store publishing and signing are not configured.

## Private repositories and API limits

Comment filtering uses the page you are already viewing and needs no token. Compare features use `api.github.com`, which does not accept your website login cookie as API authentication.

For private repositories or a higher API allowance:

1. Open extension **Settings**, either from its GitHub toolbar or its browser toolbar icon.
2. Create a fine-grained GitHub token with **Contents: read** and **Pull requests: read** for only the required repositories. Organization approval or SSO authorization may be required. Organizations that disallow fine-grained tokens may require an approved classic token; follow your organization’s policy.
3. Paste and save it in the extension settings. Retry the comparison.

Without a token, GitHub allows limited public API access. Classifying single-parent commits requires additional PR association lookups, so large comparisons can exhaust that allowance. The extension uses two concurrent classification requests and caches successful responses in background memory for one minute. Errors never appear as successful empty comparisons. Retry after the rate limit resets or configure an approved token.

Tokens are saved in local extension storage, never sync storage, and are not encrypted by the extension. They are read only in trusted extension pages/background code and sent only as an Authorization header to `https://api.github.com`; redirects are refused. They are never inserted into GitHub pages or returned to content scripts. Remove a token from settings at any time.

## Development

Requires Node.js 22.12+ and npm. Packaging uses the `zip` command.

```sh
npm ci
npm test          # API, pagination, classification, DOM filters, toolbar, and navigation
npm run lint     # JavaScript syntax and generated manifest/resource checks
npm run package  # Build both browsers and create artifacts/*.zip
npm run preview  # Local demo with synthetic data at http://127.0.0.1:8765
```

Tests include a 321-commit comparison, reverse ref ordering, incomplete pagination, squash/PR association paging, private-repository and rate-limit errors, reply preservation, exclusion of replies, safe rendering, resets, and GitHub SPA navigation. The preview uses synthetic data and never calls GitHub. Automated tests use mocked APIs and DOM fixtures; they do not replace a live extension smoke test in each browser.

Runtime code has no third-party dependencies, remote scripts, telemetry, or analytics. Build/test dependencies are development-only. The extension runs only on `github.com`; self-hosted GitHub Enterprise domains are not currently supported. It requests storage access and API access only, with no write API operations.

## API and browser references

- [GitHub compare API and pagination](https://docs.github.com/en/rest/commits/commits#compare-two-commits)
- [PRs associated with a commit](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit)
- [GitHub merge SHA semantics](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Firefox background script compatibility](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)

MIT licensed.
