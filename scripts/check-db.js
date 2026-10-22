// Sanity checks for a data-release database. The daily workflow never collects permissions or
// roles (those come from the local collect-permissions/collect-roles/build-role-map scripts) and
// only carries them forward through each restore, so a database missing them can never heal
// itself. That is how v2026.08.11 through v2026.10.22 all shipped with no permissions, no roles
// and no history before 2026-08-11: one bad restore, then every release passed the loss along.
//
// Used twice: by collect.yml straight after restoring the previous release (fail before
// collecting onto a gutted base), and by create-release.js before publishing (never release one).
//
//   node --experimental-sqlite scripts/check-db.js [path]   # exits 1 and lists every problem
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_DB_PATH = join(ROOT, 'graph-atlas.db');

const REQUIRED_TABLES = [
  ['permissions', 'run "npm run collect-permissions"'],
  ['roles', 'run "npm run collect-roles"'],
  ['role_permission_map', 'run "npm run build-role-map"'],
];

/**
 * Every reason this database must not be restored onto or released, or [] when it is sound.
 * `today` (YYYY-MM-DD) additionally requires change history from before today — a database
 * whose only changes are today's was started empty, even if the diff found real changes.
 */
export function releaseBlockers(db, { today } = {}) {
  const problems = [];
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;

  for (const [table, fix] of REQUIRED_TABLES) {
    if (count(`SELECT count(*) AS n FROM ${table}`) === 0) problems.push(`${table} is empty — ${fix}`);
  }
  if (count('SELECT count(*) AS n FROM changes') === 0) problems.push('changes is empty');
  if (today && count('SELECT count(*) AS n FROM changes WHERE snapshot_date < ?', today) === 0) {
    problems.push(`no change history before ${today} — the database was started empty rather than restored`);
  }
  return problems;
}

function main() {
  const path = process.argv[2] ?? DEFAULT_DB_PATH;
  // Checked first: opening a missing path with DatabaseSync would create an empty database.
  if (!existsSync(path)) {
    console.error(`Database check failed: ${path} does not exist.`);
    process.exit(1);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  const problems = releaseBlockers(db);
  db.close();
  if (problems.length) {
    console.error(`Database check failed for ${path}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Database check passed: ${path}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
