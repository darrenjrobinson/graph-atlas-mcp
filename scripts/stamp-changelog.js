// Invoked by the npm "version" lifecycle script (after package.json is bumped, before the
// version commit): retitles the CHANGELOG.md [Unreleased] section to the new version and
// today's date, leaving a fresh empty [Unreleased] above it. Fails if there are no
// unreleased notes — every server release must ship with release notes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const text = readFileSync(CHANGELOG_PATH, 'utf8');

if (text.includes(`## [${version}]`)) {
  console.log(`CHANGELOG.md already has a [${version}] section — leaving it as is.`);
  process.exit(0);
}

const lines = text.split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith('## [Unreleased]'));
if (start === -1) {
  console.error('CHANGELOG.md has no [Unreleased] section — add one with this release’s notes first.');
  process.exit(1);
}
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].startsWith('## [')) {
    end = i;
    break;
  }
}
if (!lines.slice(start + 1, end).join('\n').trim()) {
  console.error(`CHANGELOG.md [Unreleased] section is empty — describe what v${version} changes before releasing.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
lines.splice(start, 1, '## [Unreleased]', '', `## [${version}] - ${today}`);
writeFileSync(CHANGELOG_PATH, lines.join('\n'));
console.log(`CHANGELOG.md: stamped [Unreleased] as [${version}] - ${today}`);
