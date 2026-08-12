# Changelog

Notable changes to the graph-atlas-mcp **server** (the npm package). Daily data-only
releases — the calendar-tagged GitHub releases carrying a refreshed snapshot database —
are not listed here; each one's release notes summarise that day's detected schema changes.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/). `npm version` stamps the `[Unreleased]` section with the new
version (scripts/stamp-changelog.js), and the publish workflow turns that section into the
GitHub release notes (scripts/extract-changelog.js).

## [Unreleased]

### Fixed

- Publish workflow leaving a release half-done when a precondition failed. The tag check
  (`--verify-tag`) and changelog extraction both ran *after* `npm publish`, so publishing
  v0.3.1 without a pushed tag put the package on npm and then aborted, with no GitHub
  release and no MCP Registry entry — and no way to finish, since re-running failed on the
  already-published version. Preconditions now run before anything is published, and the
  npm and release steps are individually guarded so a partial run can be re-dispatched to
  complete the rest.

## [0.3.1] - 2026-08-12

### Fixed

- Database auto-download and the data-currency check selecting the wrong release. Both
  asked GitHub for `/releases/latest`, which returns whichever release published most
  recently — a semver server release whenever the npm publish lands after that day's data
  release. With v0.3.0 as "latest" the auto-downloader found no database asset and gave
  up, so a fresh install had no database at all and failed to start, while existing
  installs silently stopped updating. Release selection now scans the release list for the
  newest calendar-tagged (`v2026.08.11`) entry and ignores semver server releases.
- Daily collection restoring its database from the wrong release. The collect workflow ran
  a bare `gh release download`, which targets the same "latest" release and so found no
  database asset once a server release outranked the day's data release. It then started
  from an empty database — but the diff reads `snapshots/` from git, so changes were still
  detected and published, releasing a database stripped of all history, permissions, roles
  and embeddings over the good one. The workflow now resolves the newest calendar-tagged
  release explicitly, and fails loudly instead of starting fresh when a restore fails.
- `get_server_info` reporting a semver server tag as `latest_data_release`, normalised to
  a nonsensical date (`v0.3.0` → `0-3-0`). That date was still compared against real
  snapshot dates, so `local_data_current` reported `true` regardless of how stale the
  loaded database was.
- Visualiser height reports never clamping a host-provided bound upward — a 300px inline
  slot now gets a 300px report instead of 400px (the stage's CSS min-height covers visual
  degeneracy).
- The Expand toggle now starts hidden and appears only once the host advertises fullscreen
  in `availableDisplayModes`, with visibility re-derived on every sync so a capability
  arriving later still reveals it. Starting hidden also prevents `requestDisplayMode` calls
  before the connection handshake completes.

## [0.3.0] - 2026-08-10

### Added

- Expand/Minimise toggle in the visualiser toolbar. The automatic fullscreen claim is
  one-shot by design, so after minimising there was no way back to full canvas from
  inside the app; the toggle re-requests fullscreen (and can hand the surface back).
  Hidden on hosts without display-mode support.

### Fixed

- Widget height after a fullscreen → minimise → reopen cycle in Claude Desktop. The app
  echoed the host's container height back as its own desired height; host-context merges
  are partial, so a stale fullscreen height became the inline card height (an elongated
  widget). Inline now reports a fixed 600px preference capped by the host's constraint,
  size reports are deduplicated, and no re-reports are sent while fullscreen.
- Graph pinned to the top-left when the visualiser first rendered in a hidden or
  collapsed iframe, and focus drifting off-centre when the container changed shape. The
  canvas now defers centering until it has real dimensions and re-centres the focus on
  material container resizes — unless the user has panned or zoomed manually.
- Overlapping UI (legend, detail panel, welcome card stacked over the toolbar) when the
  host handed the app a very short frame: the toolbar and status bar now stack correctly
  and wrap instead of overflowing, the stage has a minimum height, and the legend scrolls
  instead of growing past the stage.

## [0.2.0] - 2026-08-10

### Added

- `get_server_info` tool — reports the running server version, its changelog entry, data
  freshness (latest snapshots and newest detected changes), and release-channel links, so
  MCP hosts can answer "what's new in Graph Atlas?" without guessing. Includes a
  best-effort data-currency check against the newest GitHub data release, with a hint when
  the loaded database is stale (e.g. a local-dev `graph-atlas.db` that never auto-updates).
- MCP server `instructions` describing what Graph Atlas is and the two release channels
  (daily calendar-tagged database releases vs semver npm server releases), injected into
  the host's context at connect time.
- Daily database releases now include a per-endpoint summary of the detected schema
  changes in the GitHub release notes (previously just a change count).
- Server releases now publish GitHub release notes from this changelog via the publish
  workflow.

## [0.1.0] - 2026-08-07

### Added

- Initial release: change search/history/detail tools, snapshot summaries, permission and
  role context, structured schema reports, and the interactive MCP Apps schema visualiser.
- Daily collection pipeline with calendar-tagged database releases and startup
  auto-download of the newest database.
