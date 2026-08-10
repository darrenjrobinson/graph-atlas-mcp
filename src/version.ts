import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Package root on disk (repo root in dev, install root when running from npm). */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

// package.json is the single source of truth for the version (synced into
// server.json by scripts/sync-server-json.js and injected into the app UI
// at bundle time by scripts/build-app-ui.js).
export const VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string }).version;
