import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as sqliteVec from 'sqlite-vec';
import { fetchLatestDataRelease } from './github-releases.js';

const CACHE_DIR = join(homedir(), '.graph-atlas-mcp');
const CACHE_DB_PATH = join(CACHE_DIR, 'graph-atlas.db');
const LOCAL_DEV_DB_PATH = join(process.cwd(), 'graph-atlas.db');

function log(message: string): void {
  // MCP stdio transport reserves stdout for JSON-RPC — all diagnostics go to stderr.
  console.error(`[graph-atlas-mcp] ${message}`);
}

function resolveDbPath(): string {
  if (process.env.GRAPH_ATLAS_DB) return process.env.GRAPH_ATLAS_DB;
  if (existsSync(CACHE_DB_PATH)) return CACHE_DB_PATH;
  if (existsSync(LOCAL_DEV_DB_PATH)) return LOCAL_DEV_DB_PATH;
  return CACHE_DB_PATH;
}

function latestSnapshotDate(db: DatabaseSync): string | null {
  const row = db.prepare('SELECT MAX(snapshot_date) AS d FROM snapshots').get() as { d: string | null } | undefined;
  return row?.d ?? null;
}

async function tryAutoDownload(dbPath: string): Promise<void> {
  try {
    const release = await fetchLatestDataRelease();
    if (!release) {
      log('auto-download skipped (no calendar-tagged data release found yet)');
      return;
    }
    const asset = release.assets.find((a) => a.name === 'graph-atlas.db' || a.name === 'graph-atlas.db.gz');
    if (!asset) {
      log(`auto-download skipped (data release ${release.tag} has no graph-atlas.db asset)`);
      return;
    }

    let localDate: string | null = null;
    if (existsSync(dbPath)) {
      try {
        const existing = new DatabaseSync(dbPath, { readOnly: true });
        localDate = latestSnapshotDate(existing);
        existing.close();
      } catch {
        localDate = null;
      }
    }
    // Both sides are YYYY-MM-DD (the tag is normalized in fetchLatestDataRelease), so a
    // lexicographic compare is a date compare.
    if (localDate && localDate >= release.date) {
      log(`local cache (${localDate}) is up to date with release ${release.date}, skipping download`);
      return;
    }

    log(`downloading ${asset.name} from release ${release.tag}...`);
    const assetRes = await fetch(asset.browser_download_url);
    if (!assetRes.ok) {
      log(`auto-download failed (HTTP ${assetRes.status}), using existing local cache if present`);
      return;
    }
    mkdirSync(dirname(dbPath), { recursive: true });
    const buf = Buffer.from(await assetRes.arrayBuffer());
    const raw = asset.name.endsWith('.gz') ? gunzipSync(buf) : buf;
    const tmpPath = `${dbPath}.download`;
    writeFileSync(tmpPath, raw);
    renameSync(tmpPath, dbPath);
    log('auto-download complete');
  } catch (err) {
    log(`auto-download skipped (${(err as Error).message})`);
  }
}

export async function openDatabase(): Promise<DatabaseSync> {
  const dbPath = resolveDbPath();

  if (dbPath === CACHE_DB_PATH) {
    await tryAutoDownload(dbPath);
  }

  if (!existsSync(dbPath)) {
    throw new Error(
      `No graph-atlas.db found at ${dbPath}. Set GRAPH_ATLAS_DB to an explicit path, place a graph-atlas.db ` +
        `in the current directory for local development, or wait for the first published GitHub Release.`,
    );
  }

  log(`using database: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: true });

  try {
    db.enableLoadExtension(true);
    sqliteVec.load(db);
    db.enableLoadExtension(false);
    log('sqlite-vec loaded — semantic search available (subject to OPENAI_API_KEY)');
  } catch (err) {
    log(`sqlite-vec unavailable (${(err as Error).message}) — search_changes will run in keyword-only mode`);
  }

  return db;
}
