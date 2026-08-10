# Changelog

Notable changes to the graph-atlas-mcp **server** (the npm package). Daily data-only
releases — the calendar-tagged GitHub releases carrying a refreshed snapshot database —
are not listed here; each one's release notes summarise that day's detected schema changes.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/). `npm version` stamps the `[Unreleased]` section with the new
version (scripts/stamp-changelog.js), and the publish workflow turns that section into the
GitHub release notes (scripts/extract-changelog.js).

## [Unreleased]

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
