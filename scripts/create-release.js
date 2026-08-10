// Creates a GitHub Release with graph-atlas.db as a gzip-compressed asset, calendar-versioned
// per PRD §7.3 (e.g. v2026.08.06). Only runs when collect-and-diff.js detected changes today.
// Requires GITHUB_TOKEN (provided automatically by GitHub Actions) and GITHUB_REPOSITORY.
// Needs --experimental-sqlite (release notes are built from today's rows in the DB).
import { DatabaseSync } from 'node:sqlite';
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB_PATH = join(ROOT, 'graph-atlas.db');
const GZ_PATH = `${DB_PATH}.gz`;
const CHANGE_COUNT_PATH = join(ROOT, '.last-collect-change-count');

const REPO = process.env.GITHUB_REPOSITORY ?? 'darrenjrobinson/graph-atlas-mcp';
const TOKEN = process.env.GITHUB_TOKEN;

async function githubApi(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Per-endpoint change list + snapshot sizes for the release body — the diff just ran, so
// everything "what's new" needs is already in the DB. Capped per endpoint to keep the body
// readable (GitHub's hard limit is 125k chars). Any failure falls back to the bare count
// line: notes must never block the daily data release.
const MAX_ROWS_PER_ENDPOINT = 40;

export function buildReleaseNotes(today, changeCount) {
  const fallback = `${changeCount} Microsoft Graph API schema change${changeCount === 1 ? '' : 's'} detected on ${today}.`;
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const lines = [fallback];
    const endpoints = db
      .prepare("SELECT DISTINCT endpoint FROM changes WHERE snapshot_date = ? AND source = 'self' ORDER BY endpoint")
      .all(today);
    for (const { endpoint } of endpoints) {
      const rows = db
        .prepare(
          `SELECT change_kind, change_target, object_name, property_name
           FROM changes WHERE snapshot_date = ? AND source = 'self' AND endpoint = ?
           ORDER BY change_kind, object_name, property_name`,
        )
        .all(today, endpoint);
      lines.push('', `### ${endpoint} (${rows.length} change${rows.length === 1 ? '' : 's'})`, '');
      for (const r of rows.slice(0, MAX_ROWS_PER_ENDPOINT)) {
        const target = r.property_name ? `${r.object_name}.${r.property_name}` : r.object_name;
        lines.push(`- ${r.change_kind}${r.change_target ? ` ${r.change_target}` : ''} \`${target}\``);
      }
      if (rows.length > MAX_ROWS_PER_ENDPOINT) {
        lines.push(`- …and ${rows.length - MAX_ROWS_PER_ENDPOINT} more — ask graph-atlas-mcp: get_recent_changes since=${today}`);
      }
    }
    const snaps = db
      .prepare('SELECT endpoint, entity_count, property_count, enum_count FROM snapshots WHERE snapshot_date = ? ORDER BY endpoint')
      .all(today);
    if (snaps.length) {
      lines.push('', '### Snapshot sizes', '');
      for (const s of snaps) {
        lines.push(`- ${s.endpoint}: ${s.entity_count} entities, ${s.property_count} properties, ${s.enum_count} enums`);
      }
    }
    db.close();
    return lines.join('\n');
  } catch (err) {
    console.error(`Release-notes generation failed (${err.message}) — falling back to the change count.`);
    return fallback;
  }
}

async function main() {
  const changeCount = existsSync(CHANGE_COUNT_PATH) ? Number(readFileSync(CHANGE_COUNT_PATH, 'utf8')) : 0;
  if (changeCount === 0) {
    console.log('No changes detected today — skipping release (snapshot already committed by the workflow).');
    return;
  }
  if (!TOKEN) {
    throw new Error('GITHUB_TOKEN not set — release creation requires running inside GitHub Actions (or a PAT for local testing).');
  }

  const today = new Date().toISOString().slice(0, 10);
  const tag = `v${today.replaceAll('-', '.')}`;

  console.log(`Compressing ${DB_PATH}...`);
  await pipeline(createReadStream(DB_PATH), createGzip(), createWriteStream(GZ_PATH));

  console.log(`Creating release ${tag} (${changeCount} changes detected today)...`);
  const release = await githubApi(`/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: buildReleaseNotes(today, changeCount),
    }),
  });

  // Asset uploads go to uploads.github.com, not api.github.com — a different host, so this
  // can't go through the githubApi() helper (which always targets api.github.com).
  const uploadUrl = `${release.upload_url.replace('{?name,label}', '')}?name=graph-atlas.db.gz`;
  console.log(`Uploading graph-atlas.db.gz to release ${release.id}...`);
  const gzBuffer = readFileSync(GZ_PATH);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/gzip',
    },
    body: gzBuffer,
  });
  if (!uploadRes.ok) {
    throw new Error(`Asset upload -> HTTP ${uploadRes.status}: ${await uploadRes.text()}`);
  }

  console.log(`Release ${tag} published: ${release.html_url}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
