// Daily collection: fetch $metadata for v1.0 + beta (both are unauthenticated — verified against
// the live endpoints, no app registration needed), parse, diff against the most recent stored
// snapshot, and load any detected changes into graph-atlas.db with source='self' (PRD §7.1).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb } from './schema.js';
import { parseCsdl, summarize } from './parse-csdl.js';
import { diffSnapshots } from './diff-snapshots.js';
import { fetchWithRetry } from './http.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB_PATH = join(ROOT, 'graph-atlas.db');
const SNAPSHOTS_DIR = join(ROOT, 'snapshots');
const ENDPOINTS = {
  'v1.0': 'https://graph.microsoft.com/v1.0/$metadata',
  beta: 'https://graph.microsoft.com/beta/$metadata',
};

const today = new Date().toISOString().slice(0, 10);

function loadPreviousSnapshot(endpoint) {
  const dir = join(SNAPSHOTS_DIR, endpoint);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${today}.json`)
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  return JSON.parse(readFileSync(join(dir, latest), 'utf8'));
}

function saveSnapshot(endpoint, snapshot) {
  const dir = join(SNAPSHOTS_DIR, endpoint);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${today}.json`), JSON.stringify(snapshot));
}

async function collectEndpoint(db, endpoint, url) {
  console.log(`[${endpoint}] fetching $metadata...`);
  let xml;
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    throw new Error(`[${endpoint}] fetch failed: ${err.message}`);
  }
  const csdlHash = createHash('sha256').update(xml).digest('hex');

  let current;
  try {
    current = parseCsdl(xml, { version: endpoint, fetchedAt: new Date().toISOString() });
  } catch (err) {
    // CSDL is a stable OData standard (PRD §14) — a parse failure means either a genuine format
    // change or bad input, not a transient issue. Surface it distinctly from fetch failures.
    throw new Error(`[${endpoint}] CSDL parse failed: ${err.message}`);
  }
  const summary = summarize(current);
  const previous = loadPreviousSnapshot(endpoint);

  // Idempotency for same-day re-runs (workflow_dispatch manual triggers, PRD §8.1/§14): clear
  // any rows this endpoint+date already produced today before re-inserting, so a re-run replaces
  // rather than duplicates.
  db.prepare(`DELETE FROM changes WHERE snapshot_date = ? AND endpoint = ? AND source = 'self'`).run(today, endpoint);
  db.prepare(`DELETE FROM snapshots WHERE snapshot_date = ? AND endpoint = ? AND source = 'self'`).run(today, endpoint);

  let changes = [];
  if (previous) {
    changes = diffSnapshots(previous, current, endpoint);
    console.log(`[${endpoint}] ${changes.length} changes vs previous snapshot`);
  } else {
    console.log(`[${endpoint}] no previous snapshot found — establishing baseline, 0 changes`);
  }

  const insertStmt = db.prepare(`
    INSERT INTO changes (
      detected_at, endpoint, object_type, object_name, property_name,
      change_kind, change_target, old_value, new_value, old_type, new_type,
      description, raw_diff, snapshot_date, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'self')
  `);
  const detectedAt = new Date().toISOString();
  for (const c of changes) {
    insertStmt.run(
      detectedAt, c.endpoint, c.object_type, c.object_name, c.property_name,
      c.change_kind, c.change_target, c.old_value, c.new_value, c.old_type, c.new_type,
      c.description, c.raw_diff, today,
    );
  }

  db.prepare(`
    INSERT INTO snapshots (snapshot_date, endpoint, csdl_hash, entity_count, property_count, enum_count, csdl_size_bytes, change_count, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'self')
  `).run(today, endpoint, csdlHash, summary.entity_count, summary.property_count, summary.enum_count, xml.length, changes.length);

  saveSnapshot(endpoint, current);
  return changes.length;
}

async function main() {
  const db = openDb(DatabaseSync, DB_PATH);
  let totalChanges = 0;
  const failures = [];

  for (const [endpoint, url] of Object.entries(ENDPOINTS)) {
    try {
      totalChanges += await collectEndpoint(db, endpoint, url);
    } catch (err) {
      console.error(err.message);
      failures.push(endpoint);
    }
  }

  console.log(`\nDone. ${totalChanges} total changes detected for ${today}.`);
  if (failures.length) console.log(`Endpoints that failed and were skipped: ${failures.join(', ')}`);
  db.close();
  // create-release.js reads this to decide whether a GitHub Release is warranted.
  writeFileSync(join(ROOT, '.last-collect-change-count'), String(totalChanges));

  // Fail the workflow run only if every endpoint failed — a single endpoint outage shouldn't
  // block the other from collecting, but total failure should surface as a CI failure.
  if (failures.length === Object.keys(ENDPOINTS).length) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
