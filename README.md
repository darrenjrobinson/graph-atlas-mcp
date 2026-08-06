# Microsoft Graph Atlas MCP

An MCP server that tracks schema changes across the Microsoft Graph API — both the changes Microsoft documents and the ones it doesn't. Covers the full Entra ID, Entra ID Governance, Identity & Access Management, Entra Agent ID, and Information Protection surface, seeded with a year of history at launch.

Full design background is in [`graph-atlas-mcp-prd.md`](./graph-atlas-mcp-prd.md).

## Why

Microsoft Graph evolves continuously across `v1.0` and `beta`. The official changelog is curated and incomplete — undocumented schema changes (new properties, removed relationships, new enum values) land in production before they're announced. This MCP closes that gap by diffing the actual `$metadata` CSDL daily, and backfills a year of history from both a public community tracker and the official changelog.

## Data sources

| Source | What it is | Granularity |
|---|---|---|
| `seed-entra-ms` | One-time import of [changes.entra.ms](https://changes.entra.ms/)'s historical CSDL diffs | Property-level |
| `backfill-graph-changelog` | One-time scrape of Microsoft's official "What's New" history, classified into 8 IAM object families | Feature-level |
| `self` | Daily `$metadata` fetch + diff, ongoing from first collection | Property-level |

Two further tables enrich every change with real-world permission/role context: `permissions` (1,036 scopes scraped from [Merill's Graph Permissions Explorer](https://graphpermissions.merill.net/permission/)) and `roles` (135 Entra built-in roles and their `microsoft.directory/*` actions, from the [Microsoft Learn permissions reference](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference)), cross-referenced into `role_permission_map`.

## Setup

Requires **Node.js 22+** (uses the built-in, experimental `node:sqlite`).

```bash
npm install
npm run build
```

### Populate the database (first run)

```bash
npm run seed                # one-off: import changes.entra.ms's ~1,600 historical records
npm run backfill            # re-runnable: scrape the official changelog for the 8 IAM families
npm run collect             # fetch v1.0 + beta $metadata, establish today's baseline snapshot
npm run collect-permissions # re-runnable, ~9 min: scrape ~1,036 Graph permission pages
npm run collect-roles       # re-runnable, ~1 min: scrape 135 Entra built-in roles + actions
npm run build-role-map      # re-runnable: cross-reference roles <-> permissions (see limitations)
```

This produces `graph-atlas.db` in the project root. `npm run seed` uses a gitignored,
one-off local script (`scripts/seed-from-entra-ms.js`) — it isn't part of the committed repo.

The DB uses WAL journal mode so these collection scripts can run concurrently with an MCP
client that already has the file open (e.g. Claude Desktop) without lock contention.

### Optional: semantic search

`search_changes` runs in hybrid (keyword + semantic) mode automatically if `OPENAI_API_KEY`
is set, and degrades to keyword-only otherwise:

```bash
export OPENAI_API_KEY=sk-...
npm run embed      # generates embeddings for any change records that don't have one yet
```

Re-running `npm run embed` after a `collect` only embeds new records — it's incremental, not a full re-embed.

## Connect it to an MCP client

Example for Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "graph-atlas": {
      "command": "node",
      "args": ["--experimental-sqlite", "/absolute/path/to/graph-atlas-mcp/dist/index.js"],
      "env": {
        "GRAPH_ATLAS_DB": "/absolute/path/to/graph-atlas-mcp/graph-atlas.db"
      }
    }
  }
}
```

`GRAPH_ATLAS_DB` points the server at an explicit DB file. Without it, the server looks for
`~/.graph-atlas-mcp/graph-atlas.db` (auto-downloaded from the latest GitHub Release once one
exists), then falls back to `./graph-atlas.db` in the current working directory.

## Tools

| Tool | Purpose |
|---|---|
| `search_changes` | Natural-language or keyword search across all sources. Hybrid (keyword + semantic via Reciprocal Rank Fusion) when an OpenAI key is configured, keyword-only otherwise. |
| `get_recent_changes` | Structured query — filter by date, endpoint, object type/name, change kind, source. |
| `get_object_history` | Full change history for one object (e.g. `group`, `accessPackage`), oldest to newest. Matches case-insensitively across sources. |
| `get_change_detail` | Full detail for a single change record, plus related changes from the same day/object. |
| `get_snapshot_summary` | Entity/property/enum counts per snapshot — "how big is Graph API right now?" |
| `get_permission_context` | Which permissions touch a Graph object, what each unlocks, who can grant them (heuristic — see limitations), and its recent changes. |

### Example queries

- "What are the recent changes to Agent ID Graph APIs?"
- "Have there been changes to groups APIs for nesting?"
- "What's the history of the accessPackageSuggestion resource?"
- "What changed in the last 7 days on the beta endpoint?"
- "Show me sensitivity label or DLP policy changes"

## How it works

1. **Daily collection** (`.github/workflows/collect.yml`, 02:00 UTC) fetches `$metadata` for both
   endpoints — both are publicly accessible, **no Entra app registration required**.
2. `scripts/parse-csdl.js` parses the CSDL XML into structured JSON (entity/complex/enum types,
   properties, navigation properties, entity sets, singletons, functions/actions).
3. `scripts/diff-snapshots.js` compares today's parse against the most recent stored snapshot
   in `snapshots/v1.0/` and `snapshots/beta/` (committed to the repo as the audit trail).
4. Detected changes are inserted into `graph-atlas.db` with `source = 'self'`; if any changes
   were found, `scripts/create-release.js` publishes an updated GitHub Release.
5. MCP clients auto-download the latest release on startup if newer than their local cache.

## Known limitations

- **Keyword search** uses `LIKE`-based matching, not real BM25 — Node's bundled `node:sqlite`
  doesn't ship the FTS5 extension. Ranking is a simple term-coverage/frequency heuristic.
- **Semantic search** requires `OPENAI_API_KEY`; vector storage uses [sqlite-vec](https://github.com/asg017/sqlite-vec) (bundled, no external vector DB).
- **`$metadata` diffing** covers schema-level changes only — not behavioral, permission, or
  endpoint-level changes that don't show up in the CSDL itself.
- Backfilled changelog records are feature-level ("Added the X resource type"), not
  property-level like the seed and self-collected data — the official changelog doesn't
  include CSDL fragments.
- **`get_permission_context` caps response size.** A common object like `user` matches 190+
  permissions, and broad permissions like `Directory.ReadWrite.All` list 300+ endpoints — an
  uncapped response hit 417KB in testing and caused a real MCP transport disconnect. Object-name
  queries are capped to 25 permissions (narrowest-first by resource count, `limit` param up to
  50) with `total_matching_count` telling you if more exist; each permission's `graph_endpoints`
  is capped to 10 with `graph_endpoints_total_count`/`graph_endpoints_truncated`. Filter to a
  specific `permission_name` to get one permission's full, untruncated detail.
- **`grantable_by` (role<->permission mapping) is a heuristic correlation, not an authoritative
  mapping.** Microsoft doesn't publish an official crosswalk between Entra RBAC actions
  (`microsoft.directory/*`) and OAuth permission scopes (`User.Read.All`, etc.) — they're two
  separate authorization systems that happen to govern overlapping resource types.
  `scripts/build-role-permission-map.js` matches a permission's primary resource (derived from
  its own name, e.g. `AdministrativeUnit.Read.All` -> `administrativeUnit`) against roles' actions
  on that same resource. Verify `grantable_by` results before treating them as authoritative.
  Matching is by **operation category** (read/create/update/delete/restore/enable/disable/invite/
  license/session/all), not a coarse read-vs-write binary — an earlier binary version produced a
  confirmed false positive ("Directory Writers" has create/update/enable/disable actions on
  `users` but no delete/restore action, yet appeared grantable_by for `User.DeleteRestore.All`
  simply because both were "write-tier"). Graph's own granular permission names
  (`DeleteRestore`, `EnableDisableAccount`, `Invite`, `ReadUpdate`, ...) are operation-specific by
  design, so `permissionRequiredCategories()` maps each verb segment to the specific action
  categories that satisfy it — verified against Microsoft's built-in roles reference across the
  full guest-lifecycle operation set (invite/create/update/enable-disable/delete-restore ×
  Guest Inviter/Directory Writers/User Administrator, all 15 combinations exact). Unrecognized/
  long-tail verbs (`ReadWrite`, `Write`, `Manage`, `FullControl`, and ~75 rarer Teams/Chat-specific
  variants) fall back to "any mutate action satisfies" — a broad permission genuinely is satisfied
  by partial write capability, so this remains a coarser signal for those specific verbs.
- Roles' Graph API route (`GET /roleManagement/directory/roleDefinitions`) requires an app
  registration with `RoleManagement.Read.Directory` + `Application.Read.All` that this project
  doesn't have configured — `collect-roles.js` uses the PRD's documented fallback (scraping the
  public Microsoft Learn permissions reference) instead.
- `permissions.combined_with` (some endpoints require multiple scopes together, e.g.
  `Application.Read.All and Policy.Read.All`) isn't populated — Merill's page structure doesn't
  expose this reliably enough to scrape.

## Acknowledgments

This project builds on data and design work from others in the Entra community — credited
here as data sources and inspiration, not as project co-authors:

- **Eric** — creator of [changes.entra.ms](https://changes.entra.ms/), the CSDL-diff tracker that seeds our historical change data
- **Merill Fernando** — creator of the [Graph Permissions Explorer](https://graphpermissions.merill.net/permission/), the data source for permission enrichment (§6)
- **EntraPulse Polyarchy** — Darren Robinson's own prior MCP; its D3 force-graph / MCP Apps visualisation pattern is the planned foundation for a future schema visualiser

## License

MIT
