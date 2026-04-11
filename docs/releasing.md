# Releasing hermes-deploy

This doc describes how the release pipeline works and covers the
one-time setup needed before the CI publish pipeline can actually
run.

> **Status (2026-04-11):** one-time setup is complete for this repo.
> `@paulcailly/hermes-deploy@1.1.1` is live on npm, the `npm-publish`
> environment is configured, and the npm trusted publisher is wired
> to `release-please.yml` + the `npm-publish` environment. Sections
> 1–5 are kept as reference for anyone forking this setup and do
> **not** need to be redone for this package. Skip to
> [Day-to-day: how a release flows](#day-to-day-how-a-release-flows).

## TL;DR (steady-state)

Once the one-time setup in sections 1–3 below is done, shipping a
release is fully automated:

1. Merge feat/fix commits to `main` using conventional commits
2. `release-please` opens a release PR a minute later
3. Merge the release PR
4. `release-please` tags the release + creates a GitHub Release
5. The `publish to npm` job runs, gated behind the `npm-publish`
   environment approval gate
6. Approve the deployment → package is published via
   trusted-publishing OIDC

No tokens. No secrets rotation. Automatic provenance attestations.

## Architecture

```
feat: commits on main
        │
        ▼
┌──────────────────────────┐
│ .github/workflows/       │
│   release-please.yml     │
│                          │
│  ┌────────────────────┐  │
│  │ release-please job │──┼──► opens / updates release PR
│  └────────────────────┘  │
│            │             │
│            │ (on merge)  │
│            ▼             │
│  ┌────────────────────┐  │
│  │ publish to npm job │──┼──► npm publish (OIDC, no token)
│  │ env: npm-publish   │  │       │
│  └────────────────────┘  │       ▼
│                          │   npm registry
│                          │  (@paulcailly/hermes-deploy)
└──────────────────────────┘
```

Two jobs, one file (`.github/workflows/release-please.yml`):

- **`release-please`** — runs on every push to `main`. Parses
  conventional commits since the last release, updates the release PR
  with the accumulated changelog, or creates/tags a release when the
  release PR is merged.
- **`publish to npm`** — runs only when `release-please` emits a new
  release (i.e. the release PR was merged). Gated behind the
  `npm-publish` GitHub environment. Uses trusted publishing via OIDC
  — no `NPM_TOKEN` secret required.

## One-time setup

### 1. Repository GitHub Actions permissions

Before `release-please` can create PRs, the repository needs to allow
workflows to create PRs. This is a single toggle buried in settings
that every release-please repo hits on first run.

1. `Settings → Actions → General`
2. Scroll to **Workflow permissions**
3. Verify:
   - ☑ **Read and write permissions** is selected
   - ☑ **Allow GitHub Actions to create and approve pull requests**
     is checked
4. **Save**

### 2. First publish (one-time bootstrap)

Trusted publishing requires the package to already exist on npm
before you can configure the trust relationship. This creates a
chicken-and-egg problem on the very first release: the package needs
to exist for you to wire up trusted publishing, but trusted
publishing is how we want to publish.

The cleanest escape hatch is a **one-time manual publish from a
maintainer's laptop**. After that, every subsequent release goes
through CI via trusted publishing automatically.

**From a maintainer's local checkout** (must have npm 2FA on the
account):

```bash
# Check out the tag release-please created
git fetch origin --tags
git checkout v1.1.0   # or whatever the first release version is

# Verify the package builds cleanly
npm ci
npm run lint
npm run typecheck
npm run test
npm run build

# Log in (prompts for username/password/OTP)
npm login

# Publish (prompts for OTP from your authenticator app)
npm publish
```

npm will prompt for your OTP during publish. This is the one-time
price of bootstrapping. After this publish succeeds, the package
exists on https://www.npmjs.com/package/@paulcailly/hermes-deploy
and subsequent steps unlock.

### 3. Configure the npm trusted publisher

1. Open https://www.npmjs.com/package/@paulcailly/hermes-deploy
2. **Settings → Trusted Publisher**
3. Click **GitHub Actions**
4. Fill in the form:

   | Field                     | Value                              |
   |---------------------------|------------------------------------|
   | Organization or user      | `PaulCailly`                       |
   | Repository                | `hermes-deploy`                    |
   | Workflow filename         | `release-please.yml`               |
   | Environment name          | `npm-publish`                      |

   All fields are case-sensitive and must match exactly. The
   workflow filename must include the `.yml` extension but NOT the
   `.github/workflows/` prefix. The environment name must match the
   `environment:` key in the publish job (`release-please.yml:33`).

5. **Save**. npm does **not** validate the configuration at save
   time — typos only surface when a publish actually runs, so
   double-check before hitting save.

### 4. Create the `npm-publish` GitHub environment

This step is independent of trusted publishing but strongly
recommended — it lets you add a required-reviewers gate so every
publish waits for your one-click approval.

1. `Settings → Environments → New environment`
2. Name: **`npm-publish`** (must match exactly)
3. Configure:
   - ☑ **Required reviewers** → add yourself
   - ☑ **Deployment branches and tags** → `Selected branches and tags`
     → add `main` only
4. Do **not** add any environment secrets. Trusted publishing uses
   OIDC instead of a `NPM_TOKEN`.

### 5. Lock down token-based publishing (optional hardening)

Once you've verified that a trusted-publishing run succeeds end to
end, tighten the package to disallow publishes via traditional tokens
altogether:

1. https://www.npmjs.com/package/@paulcailly/hermes-deploy → **Settings →
   Publishing access**
2. Select **"Require two-factor authentication and disallow tokens"**
3. **Update Package Settings**

This means:
- Trusted publishing via OIDC continues to work
- Nobody can publish via a leaked automation token, even if one is
  created
- Manual publishes from a laptop still work (with OTP)

Revoke any legacy automation tokens you created during bootstrap:
**npm avatar → Access Tokens → Delete**.

## Day-to-day: how a release flows

Once steps 1–4 are done, shipping a release looks like this:

### Committing

Use [Conventional Commits](https://www.conventionalcommits.org/).
`release-please` parses commit messages to decide the next version:

- `fix: …` → patch bump
- `feat: …` → minor bump
- `feat!: …` or any commit with `BREAKING CHANGE:` in the body →
  major bump
- `chore:`, `docs:`, `test:`, `refactor:`, `ci:` → no version bump,
  but may still appear in the changelog (see
  `release-please-config.json`)

### Release PR

When you push a commit matching one of the above to `main`,
`release-please` opens (or updates) a PR titled something like
`chore(main): release 1.2.0`. The PR contains only two things:

- A bumped version in `package.json` + `.release-please-manifest.json`
- A regenerated `CHANGELOG.md` entry

Review it like any other PR. When you merge it, `release-please`
creates the git tag (`v1.2.0`), creates a GitHub Release with the
changelog entry as the body, and that triggers the publish job.

### Publish job

1. The `publish to npm` job picks up the new release
2. Because of the `environment: npm-publish` key, GitHub pauses and
   asks for approval (if you enabled required reviewers)
3. Click **Approve and deploy** in the Actions tab
4. The job runs:
   - Sets up Node 22 + npm 11.5+
   - Installs deps, lints, typechecks, tests, builds
   - Runs `npm publish` — npm CLI auto-detects the GitHub Actions
     OIDC environment and uses it to authenticate with the trusted
     publisher registered on npmjs.com
   - Automatic provenance attestation is signed and uploaded to the
     Sigstore transparency log and npm's public-keys API

Total time: ~3 minutes from clicking Approve to the package being
live on npm.

## Rollback

npm disallows unpublishing a version after 72 hours, and even within
the window it's bad practice because consumers may already depend on
it. The correct rollback for a bad release is to publish a new
version that fixes the problem.

- **Buggy code**: push a fix, let `release-please` cut a patch
  release
- **Accidental breaking change**: push a fix that restores the old
  behavior, let `release-please` cut a patch release, and document
  the history in `CHANGELOG.md`
- **Secret leaked via provenance**: rotate the underlying secret;
  the git history / transparency log cannot be rewritten

## Troubleshooting

### "release-please failed: GitHub Actions is not permitted to create or approve pull requests"

See step 1 above. The **Allow GitHub Actions to create and approve
pull requests** checkbox at `Settings → Actions → General → Workflow
permissions` is unchecked by default on every new repo.

### "EOTP: This operation requires a one-time password"

Means the workflow is trying to publish with a token instead of via
OIDC. Check:

1. Is `NODE_AUTH_TOKEN` still set in the workflow env? Remove it.
2. Is `id-token: write` set in the workflow permissions? The publish
   job inherits it from the top-level `permissions:` block; verify
   `release-please.yml` has it.
3. Is the npm CLI on the runner at least 11.5.1? The
   `npm install -g npm@11` step before publish guarantees this.
4. Is the trusted publisher on npmjs.com configured with the exact
   workflow filename and environment name? Typos don't surface until
   publish time.

### "ENEEDAUTH: Unable to authenticate"

Same as above — means OIDC is not being picked up. Most common
causes:

- Workflow filename mismatch between the `release-please.yml` file
  and the trusted publisher configuration on npmjs.com (must match
  exactly, including the `.yml` extension)
- Environment name mismatch (`npm-publish` on both sides)
- Repository URL in `package.json` doesn't match the GitHub
  repository (must be `git+https://github.com/PaulCailly/hermes-deploy.git`)
- Workflow ran via `workflow_call` or `workflow_dispatch` indirection
  that tripped the calling-workflow check — n/a for our setup

### The publish job runs but there's no release PR

Check if `release-please` thinks there are releasable changes. Only
`feat:`, `fix:`, and breaking-change commits trigger a release PR.
A branch containing only `chore:`, `docs:`, or `test:` commits will
not produce a release.

### Node 20 deprecation warning

`googleapis/release-please-action@v4` currently runs on Node 20,
which GitHub is deprecating. It's a warning, not an error. When the
action ships a Node 24 version, bump the `@v4` in
`release-please.yml` to whatever replaces it.

## References

- [npm Trusted Publishing docs](https://docs.npmjs.com/trusted-publishers)
- [release-please docs](https://github.com/googleapis/release-please)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Sigstore transparency log](https://search.sigstore.dev/)
