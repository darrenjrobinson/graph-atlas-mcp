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

### Known gaps

Both rules above are enforced on the paths that caused the original incident, but an audit
found these still open. They are recorded rather than fixed so they aren't rediscovered from
scratch; treat them as live hazards when touching the release path.

| Gap | Where |
| --- | --- |
| `gh` succeeding with no calendar tag among the newest 100 releases is treated as "first run ever", and the job proceeds to build an empty database — the exact incident shape the rule above warns about | `.github/workflows/collect.yml` (`if [ -z "$TAG" ] … exit 0`) |
| The release is created *before* its asset is uploaded, so a failed upload leaves a calendar-tagged release carrying no `graph-atlas.db.gz` — clients find no asset and give up, and the next day's restore hard-fails on the same tag | `scripts/create-release.js` (`main`) |
| No second-line guard in JS: `openDb()` calls `new DatabaseSync(path)`, which *creates* the file, so a missing restore silently yields an empty database that still diffs against `snapshots/` and gets published. The shell in `collect.yml` is the only protection | `scripts/schema.js`, `scripts/collect-and-diff.js` |
| No sanity assertion on the restored database before collection runs | `.github/workflows/collect.yml` (after `gunzip`) |
| `fetchLatestDataRelease()` is called with no timeout, and the asset download has none either, so server startup can hang indefinitely. `src/tools/get-server-info.ts` passes `3500` and shows the intended shape | `src/db.ts` (`tryAutoDownload`) |
| No fallback to the next-older data release when the newest one carries no database asset | `src/db.ts` (`tryAutoDownload`) |
| `today` is computed independently in the collector and the release script. A UTC-midnight crossing between them desynchronises the tag date from `snapshot_date`. `buildReleaseNotes()` still emits its fallback change-count sentence, but every date-filtered part — the per-endpoint change lists and the snapshot sizes — comes back empty. Worse, the tag date is then permanently ahead of the database's newest `snapshot_date`, so the client currency check never reads as up to date and re-downloads on every startup | `scripts/collect-and-diff.js`, `scripts/create-release.js` |
| The snapshot is committed *before* the release is created, so a failed release strands that day's changes: tomorrow's baseline has advanced past them, but no published database ever carried them | `.github/workflows/collect.yml` (step order) |
| The workflow scans 100 releases and does not exclude drafts; the TypeScript side scans 300 and filters `draft` — so CI and clients can disagree about which release is newest | `.github/workflows/collect.yml` vs `src/github-releases.ts` |

## Releasing the server

Per `.github/workflows/publish.yml`: bump locally with `npm version patch|minor|major`
(which syncs `server.json` and stamps the `[Unreleased]` CHANGELOG section — that section
must have notes or the publish fails), push with tags, then dispatch the workflow. The
semver tag must exist on the commit being released, since `gh release create` runs with
`--verify-tag`.

## Database

`resolveDbPath()` in `src/db.ts` picks the database in this order:

1. `GRAPH_ATLAS_DB`, if set
2. the cache at `~/.graph-atlas-mcp/graph-atlas.db`, **if it already exists**
3. a `graph-atlas.db` in the working directory
4. otherwise the cache path, which auto-download then creates

Note the ordering: **the cache wins over a working-directory `graph-atlas.db`**, so a
checkout's own database is used only when no cache has been created yet. Auto-update on
startup runs only when the resolved path is the cache path, so a working-directory database
never auto-updates either. Between those two rules, `GRAPH_ATLAS_DB` is the only reliable
way to pin local development to a checkout's database — and forgetting it is the usual
answer to "why is my data stale?".

Scripts touching the database need `node --experimental-sqlite`.
