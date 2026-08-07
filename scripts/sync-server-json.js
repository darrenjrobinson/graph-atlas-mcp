// Syncs server.json's two version fields from package.json — the single source of
// truth for the package version. Runs from the npm `version` lifecycle hook (so
// `npm version patch|minor|major` keeps both files moving together) and from
// prepublishOnly as a drift guard.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const serverJsonPath = join(ROOT, 'server.json');
const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));

serverJson.version = version;
for (const pkg of serverJson.packages ?? []) {
  pkg.version = version;
}

writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n');
console.log(`server.json synced to version ${version}`);
