// Re-runnable: scrapes the official Microsoft Graph "What's New" changelog (raw markdown,
// mirrored publicly at microsoft-graph-docs-contrib) for the 8 object families defined in
// PRD §5b.1, and loads them into graph-atlas.db with source='backfill-graph-changelog'.
//
// Family classification is grounded in Microsoft's own category taxonomy (the "### Area |
// Subarea" headers), not free-text keyword matching against the whole changelog — keywords
// like "user" or "application" appear constantly outside IAM contexts (Teams, Files, Security
// investigations, etc.), so category-first classification avoids massive over-matching.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDb } from './schema.js';
import { fetchWithRetry } from './http.js';

const SOURCES = [
  'https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-docs-contrib/main/concepts/whats-new-earlier.md',
  'https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-docs-contrib/main/concepts/whats-new-overview.md',
];

const DB_PATH = fileURLToPath(new URL('../graph-atlas.db', import.meta.url));
const WINDOW_START = '2025-08'; // Aug 2025 — 12 months back from the Aug 2026 launch (PRD §5b.2)

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

// Categories that map directly to one of our 8 families, regardless of entry content.
const DIRECT_CATEGORY_FAMILY = {
  'agents': 'entra-agent-id',
  'agents | agent identities': 'entra-agent-id',
  'users': 'core-entra-id',
  'groups': 'core-entra-id',
  'applications': 'core-entra-id',
  'applications | service principal': 'core-entra-id',
  'applications | application template': 'core-entra-id',
  'tenants | configuration management': 'core-entra-id',
  'tenant administration | configuration management': 'core-entra-id',
  'security | data security and compliance': 'information-protection',
  'tenants | cross-tenant access': 'conditional-access',
  'tenants | cross-tenant migration': 'conditional-access',
};

// Categories that are mixed-content and require a secondary keyword check on the entry text.
const NEEDS_SUBCLASSIFICATION = new Set([
  'identity and access | identity and sign-in',
  'identity and access | governance',
  'identity and access | directory management',
  'reports | identity and access reports',
]);

const PROVISIONING_RE = /synchronizationjob|synchronizationschema|directorydefinition|onpremisesdirectorysynchronization|entrarecoveryservices|provisioningobjectsummary/i;
const IDENTITY_PROTECTION_RE = /riskyagent|riskdetection|riskyuser|riskyserviceprincipal|riskremediation/i;
const AUTH_METHODS_RE = /authenticationmethod|fido2|passwordless|temporaryaccesspass|softwareoath|hardwareoath|platformcredential|verifiablecredential|windowshelloforbusiness|x509certificate|authenticationstrength|authenticationcontext|passkey/i;
const CONDITIONAL_ACCESS_RE = /conditionalaccess|namedlocation|crosstenantaccesspolicy|permissiongrantpolicy|b2bmanagementpolicy|onpremauthenticationpolicy/i;
const AGENT_RE = /\bagent/i;

function classifyFamily(categoryLower, text) {
  if (DIRECT_CATEGORY_FAMILY[categoryLower]) return DIRECT_CATEGORY_FAMILY[categoryLower];
  if (!NEEDS_SUBCLASSIFICATION.has(categoryLower)) return null;

  if (categoryLower === 'reports | identity and access reports') {
    if (AGENT_RE.test(text)) return 'entra-agent-id';
    if (IDENTITY_PROTECTION_RE.test(text)) return 'identity-protection';
    return null;
  }

  if (categoryLower === 'identity and access | governance' || categoryLower === 'identity and access | directory management') {
    if (PROVISIONING_RE.test(text)) return 'provisioning';
    if (categoryLower === 'identity and access | governance') return 'id-governance';
    return 'core-entra-id';
  }

  if (IDENTITY_PROTECTION_RE.test(text)) return 'identity-protection';
  if (AUTH_METHODS_RE.test(text)) return 'authentication-methods';
  if (CONDITIONAL_ACCESS_RE.test(text)) return 'conditional-access';
  return 'core-entra-id';
}

function deriveEndpoint(text, monthStatus) {
  if (/view=graph-rest-beta/.test(text)) return 'beta';
  if (/view=graph-rest-1\.0/.test(text)) return 'v1.0';
  return monthStatus === 'preview' ? 'beta' : 'v1.0';
}

function deriveChangeKind(text) {
  const t = text.trim().toLowerCase();
  // Check whole-text signals before leading-verb heuristics: entries like "Added deprecation
  // notices to X" start with "added" but describe a deprecation, not an addition.
  if (t.includes('deprecat')) return 'deprecated';
  if (t.includes('removed') || t.includes('no longer support')) return 'removed';
  if (t.startsWith('renamed')) return 'renamed';
  if (t.startsWith('added') || t.startsWith('introduced') || t.startsWith('use the') || t.startsWith('use **')) return 'added';
  return 'modified';
}

function deriveChangeTarget(text) {
  const t = text.toLowerCase();
  if (t.includes('resource type')) return 'entity_type';
  if (t.includes('method') || t.includes('function') || t.includes('action')) return 'function';
  if (t.includes('enumeration')) return 'enum_value';
  return 'property';
}

function extractObjectName(text) {
  const resourceMatch = text.match(/\/graph\/api\/resources\/([a-z0-9\-]+)/i);
  if (resourceMatch) return resourceMatch[1].toLowerCase();
  const apiMatch = text.match(/\/graph\/api\/([a-z0-9\-]+)/i);
  if (apiMatch) return apiMatch[1].toLowerCase();
  return null;
}

function toPlainText(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitEntries(block) {
  const lines = block.split('\n');
  const items = [];
  let current = null;
  for (const line of lines) {
    if (/^-\s+/.test(line)) {
      if (current !== null) items.push(current.trim());
      current = line.replace(/^-\s+/, '');
    } else if (/^\d+\.\s+/.test(line)) {
      if (current !== null) items.push(current.trim());
      current = line.replace(/^\d+\.\s+/, '');
    } else if (current !== null) {
      current += ' ' + line.trim();
    } else if (line.trim()) {
      current = line;
    }
  }
  if (current !== null && current.trim()) items.push(current.trim());
  return items.filter(Boolean);
}

function parseChangelog(markdown) {
  const lines = markdown.split('\n');
  const entries = [];
  let currentMonth = null;
  let currentCategory = null;
  let buffer = [];

  function flush() {
    if (currentMonth && currentCategory && buffer.length) {
      const block = buffer.join('\n').trim();
      if (block) {
        for (const text of splitEntries(block)) {
          entries.push({ ...currentMonth, category: currentCategory, rawText: text });
        }
      }
    }
    buffer = [];
  }

  for (const line of lines) {
    const h2 = line.match(/^## ([A-Za-z]+) (\d{4}): New( and generally available| in preview only| in preview)?/i);
    if (h2) {
      flush();
      currentCategory = null;
      const monthName = h2[1].toLowerCase();
      const statusText = (h2[3] || '').toLowerCase();
      currentMonth = MONTHS[monthName]
        ? { year: h2[2], month: MONTHS[monthName], status: statusText.includes('preview') ? 'preview' : 'ga' }
        : null;
      continue;
    }
    if (/^## /.test(line)) {
      flush();
      currentMonth = null;
      currentCategory = null;
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      flush();
      currentCategory = h3[1].trim();
      continue;
    }
    if (currentMonth && currentCategory) buffer.push(line);
  }
  flush();
  return entries;
}

async function fetchText(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const db = openDb(DatabaseSync, DB_PATH);

  console.log('Clearing prior backfill-graph-changelog records (full re-load, re-runnable)...');
  db.exec("DELETE FROM changes WHERE source = 'backfill-graph-changelog'");
  db.exec("DELETE FROM snapshots WHERE source = 'backfill-graph-changelog'");

  const insertStmt = db.prepare(`
    INSERT INTO changes (
      detected_at, endpoint, object_type, object_name, property_name,
      change_kind, change_target, old_value, new_value, old_type, new_type,
      description, raw_diff, snapshot_date, source
    ) VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?, 'backfill-graph-changelog')
  `);
  const snapshotStmt = db.prepare(`
    INSERT INTO snapshots (snapshot_date, endpoint, change_count, source)
    VALUES (?, ?, ?, 'backfill-graph-changelog')
  `);

  const seen = new Set();
  const monthEndpointCounts = new Map();
  let totalInserted = 0;
  const familyCounts = {};

  for (const url of SOURCES) {
    console.log(`Fetching ${url}`);
    const markdown = await fetchText(url);
    const entries = parseChangelog(markdown);
    console.log(`  parsed ${entries.length} raw entries`);

    for (const entry of entries) {
      const yearMonth = `${entry.year}-${entry.month}`;
      if (yearMonth < WINDOW_START) continue;

      const categoryLower = entry.category.toLowerCase();
      const plainText = toPlainText(entry.rawText);
      const family = classifyFamily(categoryLower, entry.rawText.toLowerCase());
      if (!family) continue;

      const dedupeKey = `${yearMonth}|${entry.status}|${categoryLower}|${plainText}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const endpoint = deriveEndpoint(entry.rawText, entry.status);
      const snapshotDate = `${entry.year}-${entry.month}-01`;
      const objectName = extractObjectName(entry.rawText);
      const changeKind = deriveChangeKind(plainText);
      const changeTarget = deriveChangeTarget(plainText);

      insertStmt.run(
        new Date(`${snapshotDate}T00:00:00Z`).toISOString(),
        endpoint,
        objectName,
        changeKind,
        changeTarget,
        `[${entry.category}] ${plainText}`,
        snapshotDate,
      );

      const meKey = `${snapshotDate}|${endpoint}`;
      monthEndpointCounts.set(meKey, (monthEndpointCounts.get(meKey) ?? 0) + 1);
      familyCounts[family] = (familyCounts[family] ?? 0) + 1;
      totalInserted++;
    }
  }

  for (const [key, count] of monthEndpointCounts) {
    const [snapshotDate, endpoint] = key.split('|');
    snapshotStmt.run(snapshotDate, endpoint, count);
  }

  console.log(`\nDone. Inserted ${totalInserted} backfilled change records.`);
  console.log('By family:', familyCounts);
  console.log(`DB written to: ${DB_PATH}`);
  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
