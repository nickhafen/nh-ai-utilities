# CLAUDE.md

## Third-party code

- Pin every external library to an exact version (`pkg@1.2.3`), never `@latest` or a range.
- Static CDN `<script>`/`<link>` tags need `integrity` (sha384) + `crossorigin="anonymous"`. Compute with `node .github/scripts/dependency-watch.mjs sri <url>`.
- If a dependency's version isn't visible in a CDN URL (held in a constant, vendored under `vendor/`), add it to `manual` in `.github/dependency-watch.json`.
- `.github/workflows/dependency-watch.yml` checks weekly for updates and advisories and opens a "Dependency watch" issue. To act on it, use the `update-dependencies` skill.
