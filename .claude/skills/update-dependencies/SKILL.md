---
name: update-dependencies
description: Update pinned third-party code (CDN script URLs, vendored libraries, runtime imports, package manifests) safely: check for security advisories and new versions, bump pins, recompute SRI hashes, review changelogs for breaking changes, and verify the app still works. Use when the user asks to update dependencies/libraries, resolve a "Dependency watch" issue or Dependabot alert, fix a vulnerable package, or check whether third-party code is current.
---

# Update dependencies

Goal: keep third-party code **pinned to exact versions** while staying current, prioritizing security fixes.

## 1. Get the current picture

- If `.github/scripts/dependency-watch.mjs` exists, run `node .github/scripts/dependency-watch.mjs`. It lists every pinned CDN/vendored dependency, its latest version, and OSV advisories.
- If the repo has manifests (`package.json`, `requirements.txt`, `pyproject.toml`, ...), also run the ecosystem audit (`npm audit`, `npm outdated`, `pip-audit`, `pip list --outdated`) when available.
- If the user pointed to a GitHub issue or Dependabot PR, read it.

Show the user a short table and a plan, ordered:
1. **Security fixes.** Move to the smallest version that fixes the advisory, unless a newer one is equally safe.
2. **Patch/minor updates.** Usually safe to batch.
3. **Major updates.** Handle one at a time, and only after reading the changelog. Ask before doing these.

## 2. Apply each update

For every dependency being bumped:

1. **Read the release notes and changelog** between the old and new versions (GitHub releases, CHANGELOG.md). Note any breaking changes, renamed files or paths, or API changes that affect how *this* code uses the library. Grep for the library's global or imports to see the usage.
2. **Update every reference.** Grep the whole repo for the old version string. Versions often appear in more than one place: script tags, template-literal constants, worker URLs, CSP headers, comments, README, and `.github/dependency-watch.json`.
3. **SRI hashes.** Any `<script>` or `<link>` with `integrity=` needs a new hash. Compute it from the exact new URL:
   `node .github/scripts/dependency-watch.mjs sri <url>`
   (fallback: `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`). Never keep the old hash, and never remove `integrity` just to make it load.
4. **Check that the file path still exists** in the new version. CDN dist paths change between majors. Confirm the URL returns HTTP 200.
5. **Vendored copies** (e.g. `vendor/<lib>/<version>/`): download the new files into a new version folder. Include the LICENSE. Update references, then delete the old folder. Downloads come only from the official npm package (`https://registry.npmjs.org/...` tarball, or unpkg/jsdelivr for that exact version).
6. **Manifest projects:** use the package manager (`npm install pkg@x.y.z --save-exact`, etc.) so lockfiles update. Don't hand-edit lockfiles.

## 3. Verify

- Start the app (see `.claude/launch.json` or the `run` skill) and exercise the features that use each updated library. Check the browser console for load errors, SRI failures, and CSP violations.
- Run tests if any exist.
- Re-run `dependency-watch.mjs` and confirm the updated packages show ✅.

## 4. Wrap up

- Commit with a message listing each `pkg old → new` and any advisory IDs fixed (e.g. `GHSA-...`). Security fixes can be committed separately so they're easy to find.
- If an update was skipped (breaking change, needs more work), say so and why. Offer to add the package to `ignorePackages` in `.github/dependency-watch.json` only if the user wants to silence it deliberately.
- Don't push or open a PR unless asked.

## Rules

- Always pin exact versions (`@1.2.3`, never `@1`, `@latest`, or `^1.2.3` for CDN URLs).
- Every static CDN `<script>`/`<link>` should have `integrity` + `crossorigin="anonymous"` when the CDN sends CORS headers.
- Adding a new dependency the scanner can't see (version held in a variable, vendored file, non-standard CDN)? Add it to `manual` in `.github/dependency-watch.json`.
