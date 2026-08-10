// Prints the CHANGELOG.md section for one version to stdout — the publish workflow pipes
// it into the GitHub release notes. Fails if the section is missing or empty so a release
// can never go out without notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/extract-changelog.js <version>');
  process.exit(1);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const lines = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);

const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no [${version}] section — run \`npm version\` (which stamps it) before publishing.`);
  process.exit(1);
}
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].startsWith('## [')) {
    end = i;
    break;
  }
}

const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`CHANGELOG.md [${version}] section is empty — add release notes.`);
  process.exit(1);
}
console.log(body);
