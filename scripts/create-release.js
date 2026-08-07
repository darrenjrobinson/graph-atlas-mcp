// Creates a GitHub Release with graph-atlas.db as a gzip-compressed asset, calendar-versioned
// per PRD §7.3 (e.g. v2026.08.06). Only runs when collect-and-diff.js detected changes today.
// Requires GITHUB_TOKEN (provided automatically by GitHub Actions) and GITHUB_REPOSITORY.
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
      body: `${changeCount} Microsoft Graph API schema change${changeCount === 1 ? '' : 's'} detected on ${today}.`,
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
