# Working in this repo

## Commits and PRs

- **Never add `Co-Authored-By:` trailers** to commit messages, and never add
  "Generated with …" attribution lines to PR descriptions. Commit messages end at the last
  body paragraph.
- Branch for changes and open a PR; `main` is merged through review.

## Two release channels — do not conflate them

This repo publishes on two independent channels, and confusing them has already caused one
production incident:

| Channel | Tag format | Carries | Created by |
| --- | --- | --- | --- |
| **Data** — snapshot database | `v2026.08.11` (calendar) | `graph-atlas.db.gz` asset | `collect.yml` → `scripts/create-release.js`, daily when changes are detected |
| **Server** — npm package | `v0.3.1` (semver) | no assets | `publish.yml`, manually dispatched |

**Never use GitHub's `/releases/latest` (or a bare `gh release download`) to find the
database.** That endpoint returns whichever release published most *recently*, which is a
semver server release whenever an npm publish lands after that day's data release — and
those carry no database asset. Resolve the newest **calendar-tagged** release explicitly:

- TypeScript: `fetchLatestDataRelease()` in `src/github-releases.ts`
- Workflows: `gh release list --json tagName --jq` filtered on `^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}$`

Failing to restore an existing database is **not** the same as "no database exists yet".
`scripts/collect-and-diff.js` reads its diff baseline from the committed `snapshots/`
directory, not from the database, so a run that starts from an empty database still detects
changes and publishes them — releasing a database stripped of all history, permissions,
roles and embeddings over a good one. Fail loudly rather than starting fresh.

## Releasing the server

Per `.github/workflows/publish.yml`: bump locally with `npm version patch|minor|major`
(which syncs `server.json` and stamps the `[Unreleased]` CHANGELOG section — that section
must have notes or the publish fails), push with tags, then dispatch the workflow. The
semver tag must exist on the commit being released, since `gh release create` runs with
`--verify-tag`.

## Database

`GRAPH_ATLAS_DB` overrides the database path. Otherwise the cache at
`~/.graph-atlas-mcp/graph-atlas.db` is used and auto-updated on startup; a `graph-atlas.db`
in the working directory takes precedence for local development and **never auto-updates**,
which is a common source of "why is my data stale?".

Scripts touching the database need `node --experimental-sqlite`.
