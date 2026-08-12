import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fetchLatestDataRelease, GITHUB_REPO } from '../github-releases.js';
import { PACKAGE_ROOT, VERSION } from '../version.js';

export const name = 'get_server_info';
export const description =
  'About this server — running version, its changelog entry, data freshness (latest snapshots and newest ' +
  'detected changes), and how releases work: the snapshot DATABASE is re-released daily as calendar-tagged ' +
  'GitHub releases (e.g. v2026.08.07) when changes are detected, while the SERVER code ships on npm with ' +
  'semver versions (e.g. v0.1.0). Call for "what version is this?", "what\'s new in the latest Graph Atlas ' +
  'release?", or to check whether the local data is current.';

export const inputSchema = {};

const REPO_URL = `https://github.com/${GITHUB_REPO}`;

/**
 * Newest calendar-tagged data release on GitHub, or null when offline/unreachable.
 * Best-effort with a short timeout — data currency is advisory, never worth blocking on.
 */
async function latestDataRelease(): Promise<{ tag: string; date: string; published_at: string } | null> {
  try {
    const release = await fetchLatestDataRelease(3500);
    return release && { tag: release.tag, date: release.date, published_at: release.published_at };
  } catch {
    return null;
  }
}

/** Body of one `## [version]` section of CHANGELOG.md, or null if absent. */
function changelogSection(version: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(PACKAGE_ROOT, 'CHANGELOG.md'), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

export async function handler(db: DatabaseSync, _args: Record<string, never>) {
  const databasePath = (db.prepare('PRAGMA database_list').get() as { file?: string } | undefined)?.file ?? null;

  const latestSnapshots = db
    .prepare(
      `SELECT endpoint, snapshot_date, source, entity_count, property_count, enum_count, change_count
       FROM snapshots
       WHERE (endpoint, snapshot_date) IN (SELECT endpoint, MAX(snapshot_date) FROM snapshots GROUP BY endpoint)
       ORDER BY endpoint`,
    )
    .all();

  const changeStats = db
    .prepare('SELECT COUNT(*) AS total_changes, MIN(snapshot_date) AS earliest, MAX(snapshot_date) AS latest FROM changes')
    .get() as { total_changes: number; earliest: string | null; latest: string | null };

  const newestChanges = changeStats.latest
    ? (db.prepare('SELECT COUNT(*) AS count FROM changes WHERE snapshot_date = ?').get(changeStats.latest) as { count: number })
    : null;

  const changesBySource = db.prepare('SELECT source, COUNT(*) AS changes FROM changes GROUP BY source ORDER BY changes DESC').all();

  const localDataDate = latestSnapshots.reduce<string | null>(
    (max, s) => ((s as { snapshot_date: string }).snapshot_date > (max ?? '') ? (s as { snapshot_date: string }).snapshot_date : max),
    null,
  );
  const newestRelease = await latestDataRelease();
  const localDataCurrent = newestRelease && localDataDate ? localDataDate >= newestRelease.date : null;

  const info = {
    server: {
      name: 'graph-atlas-mcp',
      version: VERSION,
      description:
        'Tracks documented and undocumented Microsoft Graph API schema changes (v1.0 and beta) across Entra ID, ' +
        'Identity Governance, and related workloads, with permission/role context and an interactive schema visualiser.',
      changelog_for_this_version: changelogSection(VERSION),
    },
    data: {
      database_path: databasePath,
      latest_snapshots: latestSnapshots,
      newest_changes: changeStats.latest ? { snapshot_date: changeStats.latest, count: newestChanges?.count ?? 0 } : null,
      change_history: { total_changes: changeStats.total_changes, earliest: changeStats.earliest, latest: changeStats.latest },
      changes_by_source: changesBySource,
      latest_data_release: newestRelease ?? 'unknown (GitHub unreachable — currency check skipped)',
      local_data_current: localDataCurrent,
      ...(localDataCurrent === false
        ? {
            hint:
              'The loaded database predates the newest data release. If database_path is a working-directory ' +
              'graph-atlas.db (local-dev override) it never auto-updates — remove or refresh it, set GRAPH_ATLAS_DB, ' +
              'or run from a directory without one so the auto-downloading cache is used.',
          }
        : {}),
    },
    releases: {
      data: `The snapshot database is re-released as a calendar-tagged GitHub release (e.g. v2026.08.07) each day changes are detected; the release notes summarise that day's schema changes, and the server auto-downloads the newest database on startup.`,
      server: `The server code is released on npm as graph-atlas-mcp with semver versions (e.g. v${VERSION}); GitHub release notes for those tags carry the changelog.`,
      note: 'Users saying "a new Graph Atlas release" may mean either channel — check latest_snapshots for data recency, server.version for the code.',
    },
    links: {
      repository: REPO_URL,
      releases: `${REPO_URL}/releases`,
      changelog: `${REPO_URL}/blob/main/CHANGELOG.md`,
      npm: 'https://www.npmjs.com/package/graph-atlas-mcp',
    },
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
  };
}
