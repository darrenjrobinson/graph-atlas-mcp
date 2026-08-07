import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOTS_DIR = fileURLToPath(new URL('../snapshots', import.meta.url));
const MAX_NEIGHBORHOOD_NODES = 40;
const MAX_OVERVIEW_NODES = 30;
const MAX_ROLE_PERMISSIONS = 12;
const MAX_ROLE_ENTITIES = 20;
const MAX_PERMISSION_ENTITIES = 15;
const MAX_PERMISSION_ROLES = 8;
const MAX_USAGE_PERMISSIONS = 15;
const MAX_ENTITY_ROLE_PERMISSIONS = 10;
const MAX_ENTITY_ROLES = 12;

interface ParsedProperty {
  name: string;
  type: string;
}

interface ParsedEntityType {
  baseType: string | null;
  properties: Record<string, ParsedProperty>;
  navigationProperties: Record<string, ParsedProperty>;
}

interface ParsedSnapshot {
  version: string;
  fetchedAt: string;
  entityTypes: Record<string, ParsedEntityType>;
}

export type ViewKind = 'entity' | 'permission' | 'role';
export type EdgeKind = 'navigation_property' | 'inheritance' | 'grants' | 'touches';
export type NodeKind = 'EntityType' | 'Permission' | 'Role';

/**
 * The Polyarchy node contract: the UI (and any consumer) branches only on
 * `kind`; every domain field lives in the `data` bag. Entity ids are always
 * lowercase (see canonicalEntityId) so the same entity merges into one node
 * no matter which view produced it — labels keep the original casing.
 */
export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
}

/** One expansion step around a single node — what expand_schema_node returns. */
export interface Delta {
  nodes: GraphNode[];
  edges: GraphEdge[];
  message: string;
}

export interface GraphResult {
  view: ViewKind;
  endpoint: string | null;
  snapshot_date: string | null;
  focus_object: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_count: number;
  truncated: boolean;
}

export interface SearchResult {
  id: string;
  kind: NodeKind;
  label: string;
  sub: string;
}

// CSDL uses the fully-qualified "microsoft.graph.X" form for top-level type declarations, but
// the short alias "graph.X" (via <edmx:Include Namespace="microsoft.graph" Alias="graph"/>) for
// every in-document reference — BaseType attributes and NavigationProperty type strings. Both
// must be stripped or cross-references silently fail to match declared type keys (verified: this
// bug made overview-mode graphs return zero edges, since baseType/navProp targets stayed as
// "graph.directoryObject" while node ids were stripped to "directoryObject").
const stripNamespace = (name: string) => name.replace(/^(microsoft\.graph|graph)\./, '');

// Entity names aren't consistently cased across sources (CSDL camelCase vs Merill's permission
// pages) — every entity node id is lowercase so one entity is one node across all views, with
// the first-seen original casing kept as the display label.
export function canonicalEntityId(name: string): string {
  return stripNamespace(name).toLowerCase();
}

/**
 * `since` accepts an ISO date or a plain day count ("30" → 30 days ago). The UI's window picker
 * sends day counts; SQLite compares snapshot_date lexicographically so anything else must
 * already be ISO. Undefined defaults to 30 days ago.
 */
export function normalizeSince(since?: string): string {
  if (since && /^\d+$/.test(since)) {
    return new Date(Date.now() - Number(since) * 86_400_000).toISOString().slice(0, 10);
  }
  return since ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
}

/** Edge factory — the id makes edges self-deduplicating in the app's session cache. */
function edge(source: string, kind: EdgeKind, target: string, label: string): GraphEdge {
  return { id: `${source}|${kind}|${target}|${label}`, source, target, kind, label };
}

function loadLatestSnapshot(endpoint: string): ParsedSnapshot | null {
  const dir = join(SNAPSHOTS_DIR, endpoint);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'));
}

/** Target entity type referenced by a navigation property's OData type string, e.g.
 * "Collection(microsoft.graph.group)" or "microsoft.graph.educationClass" -> "group"/"educationClass". */
function targetTypeOf(odataType: string): string | null {
  const m = odataType.match(/^Collection\(([^)]+)\)$/) ?? [null, odataType];
  const inner = m[1];
  if (!inner || inner.startsWith('Edm.')) return null;
  return stripNamespace(inner);
}

function changeCounts(db: DatabaseSync, endpoint: string, since: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT lower(object_name) AS name, COUNT(*) AS c FROM changes WHERE endpoint = ? AND snapshot_date >= ? AND object_name IS NOT NULL GROUP BY lower(object_name)`)
    .all(endpoint, since) as Array<{ name: string; c: number }>;
  return new Map(rows.map((r) => [r.name, r.c]));
}

/** Change counts summed across both endpoints — for views that aren't endpoint-scoped. */
function combinedChangeCounts(db: DatabaseSync, since: string): Map<string, number> {
  const counts = changeCounts(db, 'v1.0', since);
  for (const [k, v] of changeCounts(db, 'beta', since)) counts.set(k, (counts.get(k) ?? 0) + v);
  return counts;
}

// ---------- node factories ----------

function toEntityNode(fqName: string, entityType: ParsedEntityType, counts: Map<string, number>, endpoint: string): GraphNode {
  const shortName = stripNamespace(fqName);
  const id = shortName.toLowerCase();
  return {
    id,
    kind: 'EntityType',
    label: shortName,
    data: {
      base_type: entityType.baseType ? stripNamespace(entityType.baseType) : null,
      change_count: counts.get(id) ?? 0,
      property_count: Object.keys(entityType.properties ?? {}).length,
      navigation_property_count: Object.keys(entityType.navigationProperties ?? {}).length,
      endpoint,
    },
  };
}

/** Entity node from a permission's resource list — no snapshot backing, so only change data. */
function sparseEntityNode(name: string, counts: Map<string, number>): GraphNode {
  const id = canonicalEntityId(name);
  return { id, kind: 'EntityType', label: stripNamespace(name), data: { change_count: counts.get(id) ?? 0 } };
}

interface PermissionRow {
  permission_name: string;
  display_text: string | null;
  description_app: string | null;
  description_delegated: string | null;
  admin_consent_required_app: number | null;
  admin_consent_required_delegated: number | null;
  resources: string;
}

const PERMISSION_COLUMNS =
  'permission_name, display_text, description_app, description_delegated, admin_consent_required_app, admin_consent_required_delegated, resources';

function toPermissionNode(row: PermissionRow): GraphNode {
  const resources: string[] = JSON.parse(row.resources || '[]');
  return {
    id: row.permission_name,
    kind: 'Permission',
    label: row.permission_name,
    data: {
      admin_consent_app: row.admin_consent_required_app == null ? null : Boolean(row.admin_consent_required_app),
      admin_consent_delegated: row.admin_consent_required_delegated == null ? null : Boolean(row.admin_consent_required_delegated),
      description: row.display_text ?? row.description_app ?? row.description_delegated ?? null,
      resource_count: resources.length,
    },
  };
}

interface RoleRow {
  role_name: string;
  template_id: string;
  description: string | null;
  is_privileged: number;
  actions?: string | null;
}

const ROLE_COLUMNS = 'role_name, template_id, description, is_privileged, actions';

function actionCountOf(role: RoleRow): number {
  return (JSON.parse(role.actions || '[]') as unknown[]).length;
}

function toRoleNode(role: RoleRow, blastRadius: number): GraphNode {
  return {
    id: role.role_name,
    kind: 'Role',
    label: role.role_name,
    data: {
      is_privileged: Boolean(role.is_privileged),
      blast_radius: blastRadius,
      action_count: actionCountOf(role),
      description: role.description ?? null,
      template_id: role.template_id,
    },
  };
}

function grantedPermissionsOf(db: DatabaseSync, templateId: string): Array<{ permission_name: string; resources: string }> {
  return db
    .prepare(
      `SELECT p.permission_name, p.resources FROM role_permission_map m
       JOIN permissions p ON p.permission_name = m.permission_name
       WHERE m.role_template_id = ?`,
    )
    .all(templateId) as Array<{ permission_name: string; resources: string }>;
}

function blastRadiusOf(grantedPermissions: Array<{ resources: string }>): number {
  return new Set(grantedPermissions.flatMap((p) => (JSON.parse(p.resources || '[]') as string[]).map(canonicalEntityId))).size;
}

// ---------- per-node expansion deltas (expand_schema_node + focus branches) ----------

/**
 * The schema neighborhood of one entity type: its base type, its navigation targets, and
 * every type that inherits from or navigates to it. Ranked by change activity when over limit.
 */
export function entityNeighborhoodDelta(
  db: DatabaseSync,
  opts: { nodeId: string; endpoint?: 'v1.0' | 'beta'; since?: string; limit?: number },
): Delta | { error: string } {
  const endpoint = opts.endpoint ?? 'v1.0';
  const snapshot = loadLatestSnapshot(endpoint);
  if (!snapshot) return { error: `No snapshot found for endpoint ${endpoint} — run "npm run collect" first.` };

  const since = normalizeSince(opts.since);
  const counts = changeCounts(db, endpoint, since);
  const entityTypes = snapshot.entityTypes;

  const focusLower = canonicalEntityId(opts.nodeId);
  const focusEntry = Object.entries(entityTypes).find(([fq]) => canonicalEntityId(fq) === focusLower);
  if (!focusEntry) return { error: `Entity type "${opts.nodeId}" not found in the ${endpoint} schema.` };
  const [focusFqName, focusType] = focusEntry;
  const focusShort = stripNamespace(focusFqName);

  const neighborhood = new Set<string>([focusShort]);
  if (focusType.baseType) neighborhood.add(stripNamespace(focusType.baseType));
  for (const navProp of Object.values(focusType.navigationProperties ?? {})) {
    const target = targetTypeOf(navProp.type);
    if (target) neighborhood.add(target);
  }
  // Incoming edges: other types that reference or inherit from the focus type.
  for (const [fq, et] of Object.entries(entityTypes)) {
    const short = stripNamespace(fq);
    if (short === focusShort) continue;
    if (et.baseType && stripNamespace(et.baseType) === focusShort) neighborhood.add(short);
    for (const navProp of Object.values(et.navigationProperties ?? {})) {
      if (targetTypeOf(navProp.type) === focusShort) neighborhood.add(short);
    }
  }

  const limit = opts.limit ?? MAX_NEIGHBORHOOD_NODES;
  let included: Set<string>;
  let truncated = false;
  if (neighborhood.size > limit) {
    const ranked = [...neighborhood]
      .filter((n) => n !== focusShort)
      .sort((a, b) => (counts.get(b.toLowerCase()) ?? 0) - (counts.get(a.toLowerCase()) ?? 0))
      .slice(0, limit - 1);
    included = new Set([focusShort, ...ranked]);
    truncated = true;
  } else {
    included = neighborhood;
  }

  const nodes = Object.entries(entityTypes)
    .filter(([fq]) => included.has(stripNamespace(fq)))
    .map(([fq, et]) => toEntityNode(fq, et, counts, endpoint));
  const edges = edgesAmong(entityTypes, included);

  const message =
    `${focusShort}: ${nodes.length - 1} related entity types, ${edges.length} relationships (${endpoint})` +
    (truncated ? ` — most-changed ${limit - 1} of ${neighborhood.size - 1} neighbors shown` : '');
  return { nodes, edges, message };
}

/**
 * Reverse permission lookup for one entity type: which permission scopes touch it.
 * Most-specific permissions (fewest resources) first.
 */
export function entityUsageDelta(db: DatabaseSync, opts: { nodeId: string; since?: string; limit?: number }): Delta | { error: string } {
  const since = normalizeSince(opts.since);
  const counts = combinedChangeCounts(db, since);
  const entityId = canonicalEntityId(opts.nodeId);

  const all = db.prepare(`SELECT ${PERMISSION_COLUMNS} FROM permissions`).all() as unknown as PermissionRow[];
  const touching = all.filter((row) => {
    const resources: string[] = JSON.parse(row.resources || '[]');
    return resources.some((r) => canonicalEntityId(r) === entityId);
  });
  if (touching.length === 0) return { error: `No permissions touch entity type "${opts.nodeId}".` };

  touching.sort((a, b) => JSON.parse(a.resources || '[]').length - JSON.parse(b.resources || '[]').length);
  const limit = opts.limit ?? MAX_USAGE_PERMISSIONS;
  const shown = touching.slice(0, limit);

  const nodes: GraphNode[] = [sparseEntityNode(opts.nodeId, counts)];
  const edges: GraphEdge[] = [];
  for (const row of shown) {
    nodes.push(toPermissionNode(row));
    edges.push(edge(row.permission_name, 'touches', entityId, 'touches'));
  }

  const message =
    `${stripNamespace(opts.nodeId)}: touched by ${touching.length} permission(s)` +
    (touching.length > shown.length ? `, showing the ${shown.length} most specific` : '');
  return { nodes, edges, message };
}

/**
 * The roles that can reach one entity type — two hops via the permissions that touch it
 * (role -grants-> permission -touches-> entity). Role links come from the heuristic
 * role↔permission map, so this is an indicative reachability view, not authoritative.
 */
export function entityRolesDelta(db: DatabaseSync, opts: { nodeId: string; since?: string }): Delta | { error: string } {
  const since = normalizeSince(opts.since);
  const counts = combinedChangeCounts(db, since);
  const entityId = canonicalEntityId(opts.nodeId);

  const all = db.prepare(`SELECT ${PERMISSION_COLUMNS} FROM permissions`).all() as unknown as PermissionRow[];
  const touching = all.filter((row) => {
    const resources: string[] = JSON.parse(row.resources || '[]');
    return resources.some((r) => canonicalEntityId(r) === entityId);
  });
  if (touching.length === 0) return { error: `No permissions touch entity type "${opts.nodeId}".` };
  touching.sort((a, b) => JSON.parse(a.resources || '[]').length - JSON.parse(b.resources || '[]').length);

  const grantingRolesStmt = db.prepare(
    `SELECT r.role_name, r.template_id, r.description, r.is_privileged, r.actions FROM role_permission_map m
     JOIN roles r ON r.template_id = m.role_template_id
     WHERE m.permission_name = ?`,
  );

  const nodes: GraphNode[] = [sparseEntityNode(opts.nodeId, counts)];
  const edges: GraphEdge[] = [];
  const seenRoles = new Set<string>();
  const shownPerms = touching.slice(0, MAX_ENTITY_ROLE_PERMISSIONS);

  for (const row of shownPerms) {
    nodes.push(toPermissionNode(row));
    edges.push(edge(row.permission_name, 'touches', entityId, 'touches'));

    const grantingRoles = grantingRolesStmt.all(row.permission_name) as unknown as RoleRow[];
    for (const role of grantingRoles) {
      if (!seenRoles.has(role.role_name)) {
        if (seenRoles.size >= MAX_ENTITY_ROLES) continue; // skip edge too — its role node isn't shown
        seenRoles.add(role.role_name);
        nodes.push(toRoleNode(role, blastRadiusOf(grantedPermissionsOf(db, role.template_id))));
      }
      edges.push(edge(role.role_name, 'grants', row.permission_name, 'grants'));
    }
  }

  const permTrunc = touching.length > shownPerms.length ? ` (showing the ${shownPerms.length} most specific)` : '';
  const message =
    `${stripNamespace(opts.nodeId)}: touched by ${touching.length} permission(s)${permTrunc}; ` +
    `${seenRoles.size} role(s) can reach it via those (heuristic role map)`;
  return { nodes, edges, message };
}

/** One permission's reach: the entity types it touches and the roles that grant it. */
export function permissionDelta(db: DatabaseSync, opts: { nodeId: string; since?: string }): Delta | { error: string } {
  const row = db.prepare(`SELECT ${PERMISSION_COLUMNS} FROM permissions WHERE permission_name = ?`).get(opts.nodeId) as PermissionRow | undefined;
  if (!row) return { error: `Permission "${opts.nodeId}" not found.` };

  const since = normalizeSince(opts.since);
  const counts = combinedChangeCounts(db, since);

  const nodes: GraphNode[] = [toPermissionNode(row)];
  const edges: GraphEdge[] = [];

  const resources: string[] = JSON.parse(row.resources || '[]');
  const cappedResources = resources.slice(0, MAX_PERMISSION_ENTITIES);
  const seenEntities = new Set<string>();
  for (const resource of cappedResources) {
    const entityId = canonicalEntityId(resource);
    if (!seenEntities.has(entityId)) {
      seenEntities.add(entityId);
      nodes.push(sparseEntityNode(resource, counts));
    }
    edges.push(edge(row.permission_name, 'touches', entityId, 'touches'));
  }

  const grantingRoles = db
    .prepare(
      `SELECT r.role_name, r.template_id, r.description, r.is_privileged, r.actions FROM role_permission_map m
       JOIN roles r ON r.template_id = m.role_template_id
       WHERE m.permission_name = ?`,
    )
    .all(opts.nodeId) as unknown as RoleRow[];
  const cappedRoles = grantingRoles.slice(0, MAX_PERMISSION_ROLES);
  for (const role of cappedRoles) {
    nodes.push(toRoleNode(role, blastRadiusOf(grantedPermissionsOf(db, role.template_id))));
    edges.push(edge(role.role_name, 'grants', row.permission_name, 'grants'));
  }

  const entTrunc = resources.length > cappedResources.length ? ` (showing ${cappedResources.length})` : '';
  const roleTrunc = grantingRoles.length > cappedRoles.length ? ` (showing ${cappedRoles.length})` : '';
  const message = `${row.permission_name}: touches ${resources.length} entity type(s)${entTrunc}, granted by ${grantingRoles.length} role(s)${roleTrunc}`;
  return { nodes, edges, message };
}

/** One role's reach: the permissions it grants and the entity types those touch. */
export function roleDelta(db: DatabaseSync, opts: { nodeId: string; since?: string }): Delta | { error: string } {
  const role = db.prepare(`SELECT ${ROLE_COLUMNS} FROM roles WHERE role_name = ?`).get(opts.nodeId) as RoleRow | undefined;
  if (!role) return { error: `Role "${opts.nodeId}" not found.` };

  const since = normalizeSince(opts.since);
  const counts = combinedChangeCounts(db, since);
  const grantedPermissions = grantedPermissionsOf(db, role.template_id);
  const blastRadius = blastRadiusOf(grantedPermissions);

  const nodes: GraphNode[] = [toRoleNode(role, blastRadius)];
  const edges: GraphEdge[] = [];

  const permsToShow = grantedPermissions.slice(0, MAX_ROLE_PERMISSIONS);
  const seenEntities = new Set<string>();
  let entitiesShown = 0;

  for (const perm of permsToShow) {
    const row = db.prepare(`SELECT ${PERMISSION_COLUMNS} FROM permissions WHERE permission_name = ?`).get(perm.permission_name) as
      | PermissionRow
      | undefined;
    if (row) nodes.push(toPermissionNode(row));
    edges.push(edge(role.role_name, 'grants', perm.permission_name, 'grants'));

    const resources: string[] = JSON.parse(perm.resources || '[]');
    for (const resource of resources) {
      const entityId = canonicalEntityId(resource);
      if (entitiesShown >= MAX_ROLE_ENTITIES && !seenEntities.has(entityId)) break;
      if (!seenEntities.has(entityId)) {
        seenEntities.add(entityId);
        nodes.push(sparseEntityNode(resource, counts));
        entitiesShown++;
      }
      edges.push(edge(perm.permission_name, 'touches', entityId, 'touches'));
    }
  }

  const permTrunc = grantedPermissions.length > permsToShow.length ? ` (showing ${permsToShow.length})` : '';
  // Roles with no published RBAC actions (e.g. the Purview Workload Content roles) are
  // managed outside Entra — "grants 0" would misread as powerless.
  const message =
    grantedPermissions.length === 0 && actionCountOf(role) === 0
      ? `${role.role_name}: no published RBAC actions — permissions are managed outside Entra (e.g. Microsoft Purview role groups)`
      : `${role.role_name}: grants ${grantedPermissions.length} permission(s)${permTrunc}, reaching ${blastRadius} entity types`;
  return { nodes, edges, message };
}

// ---------- full-view builders (launcher + schema_change_report) ----------

function edgesAmong(entityTypes: Record<string, ParsedEntityType>, includedShortNames: Set<string>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const [fqName, entityType] of Object.entries(entityTypes)) {
    const shortName = stripNamespace(fqName);
    if (!includedShortNames.has(shortName)) continue;
    const sourceId = shortName.toLowerCase();

    if (entityType.baseType) {
      const baseShort = stripNamespace(entityType.baseType);
      if (includedShortNames.has(baseShort)) {
        edges.push(edge(sourceId, 'inheritance', baseShort.toLowerCase(), 'inherits'));
      }
    }
    for (const navProp of Object.values(entityType.navigationProperties ?? {})) {
      const target = targetTypeOf(navProp.type);
      if (target && includedShortNames.has(target)) {
        edges.push(edge(sourceId, 'navigation_property', target.toLowerCase(), navProp.name));
      }
    }
  }
  return edges;
}

export function buildEntityGraph(
  db: DatabaseSync,
  opts: { endpoint?: 'v1.0' | 'beta'; focusObject?: string; since?: string; limit?: number } = {},
): GraphResult | { error: string } {
  const endpoint = opts.endpoint ?? 'v1.0';
  const snapshot = loadLatestSnapshot(endpoint);
  if (!snapshot) return { error: `No snapshot found for endpoint ${endpoint} — run "npm run collect" first.` };
  const totalEntityTypes = Object.keys(snapshot.entityTypes).length;
  const snapshotDate = snapshot.fetchedAt.slice(0, 10);

  if (opts.focusObject) {
    const delta = entityNeighborhoodDelta(db, { nodeId: opts.focusObject, endpoint, since: opts.since, limit: opts.limit });
    if ('error' in delta) return delta;
    return {
      view: 'entity',
      endpoint,
      snapshot_date: snapshotDate,
      focus_object: canonicalEntityId(opts.focusObject),
      nodes: delta.nodes,
      edges: delta.edges,
      total_count: totalEntityTypes,
      truncated: delta.message.includes('shown'),
    };
  }

  const since = normalizeSince(opts.since);
  const counts = changeCounts(db, endpoint, since);
  const entityTypes = snapshot.entityTypes;

  const ranked = Object.keys(entityTypes)
    .map((fq) => stripNamespace(fq))
    .sort((a, b) => (counts.get(b.toLowerCase()) ?? 0) - (counts.get(a.toLowerCase()) ?? 0));
  const limit = opts.limit ?? MAX_OVERVIEW_NODES;
  const includedShortNames = new Set(ranked.slice(0, limit));

  const nodes = Object.entries(entityTypes)
    .filter(([fq]) => includedShortNames.has(stripNamespace(fq)))
    .map(([fq, et]) => toEntityNode(fq, et, counts, endpoint));
  const edges = edgesAmong(entityTypes, includedShortNames);

  return {
    view: 'entity',
    endpoint,
    snapshot_date: snapshotDate,
    focus_object: null,
    nodes,
    edges,
    total_count: totalEntityTypes,
    truncated: ranked.length > limit,
  };
}

export function buildPermissionGraph(
  db: DatabaseSync,
  opts: { focusObject?: string; since?: string; limit?: number } = {},
): GraphResult | { error: string } {
  const totalCount = (db.prepare('SELECT COUNT(*) c FROM permissions').get() as { c: number }).c;

  if (opts.focusObject) {
    const delta = permissionDelta(db, { nodeId: opts.focusObject, since: opts.since });
    if ('error' in delta) return delta;
    return {
      view: 'permission',
      endpoint: null,
      snapshot_date: null,
      focus_object: opts.focusObject,
      nodes: delta.nodes,
      edges: delta.edges,
      total_count: totalCount,
      truncated: delta.message.includes('showing'),
    };
  }

  // Overview: broadest permissions (most distinct resources touched) are the most informative
  // to see first — narrow single-resource permissions are more useful once you're already
  // focused on a specific object via get_permission_context.
  const all = db.prepare(`SELECT ${PERMISSION_COLUMNS} FROM permissions`).all() as unknown as PermissionRow[];
  all.sort((a, b) => JSON.parse(b.resources || '[]').length - JSON.parse(a.resources || '[]').length);
  const limit = opts.limit ?? 10;
  const permissionRows = all.slice(0, limit);
  let truncated = all.length > limit;

  const since = normalizeSince(opts.since);
  const counts = combinedChangeCounts(db, since);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenEntities = new Set<string>();

  for (const row of permissionRows) {
    nodes.push(toPermissionNode(row));
    const resources: string[] = JSON.parse(row.resources || '[]');
    const capped = resources.slice(0, Math.ceil(MAX_PERMISSION_ENTITIES / permissionRows.length) || 1);
    if (resources.length > capped.length) truncated = true;

    for (const resource of capped) {
      const entityId = canonicalEntityId(resource);
      if (!seenEntities.has(entityId)) {
        seenEntities.add(entityId);
        nodes.push(sparseEntityNode(resource, counts));
      }
      edges.push(edge(row.permission_name, 'touches', entityId, 'touches'));
    }
  }

  return {
    view: 'permission',
    endpoint: null,
    snapshot_date: null,
    focus_object: null,
    nodes,
    edges,
    total_count: totalCount,
    truncated,
  };
}

export function buildRoleGraph(db: DatabaseSync, opts: { focusObject?: string; since?: string; limit?: number } = {}): GraphResult | { error: string } {
  const totalCount = (db.prepare('SELECT COUNT(*) c FROM roles').get() as { c: number }).c;

  if (opts.focusObject) {
    const delta = roleDelta(db, { nodeId: opts.focusObject, since: opts.since });
    if ('error' in delta) return delta;
    return {
      view: 'role',
      endpoint: null,
      snapshot_date: null,
      focus_object: opts.focusObject,
      nodes: delta.nodes,
      edges: delta.edges,
      total_count: totalCount,
      truncated: delta.message.includes('showing'),
    };
  }

  // Overview: roles ranked by blast radius (how many permissions they can grant) — the
  // biggest, most consequential roles are the most informative to see first.
  const all = db.prepare(`SELECT ${ROLE_COLUMNS} FROM roles`).all() as unknown as RoleRow[];
  const grantCounts = db.prepare('SELECT role_template_id, COUNT(*) c FROM role_permission_map GROUP BY role_template_id').all() as Array<{
    role_template_id: string;
    c: number;
  }>;
  const grantCountMap = new Map(grantCounts.map((r) => [r.role_template_id, r.c]));
  all.sort((a, b) => (grantCountMap.get(b.template_id) ?? 0) - (grantCountMap.get(a.template_id) ?? 0));
  const limit = opts.limit ?? 8;
  const roleRows = all.slice(0, limit);
  let truncated = all.length > limit;

  const since = normalizeSince(opts.since);
  const counts = combinedChangeCounts(db, since);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenPermissions = new Set<string>();
  const seenEntities = new Set<string>();

  for (const role of roleRows) {
    const grantedPermissions = grantedPermissionsOf(db, role.template_id);
    nodes.push(toRoleNode(role, blastRadiusOf(grantedPermissions)));

    const permCap = Math.max(1, Math.floor(MAX_ROLE_PERMISSIONS / roleRows.length));
    const permsToShow = grantedPermissions.slice(0, permCap);
    if (grantedPermissions.length > permsToShow.length) truncated = true;

    const entityBudgetPerRole = Math.max(1, Math.floor(MAX_ROLE_ENTITIES / roleRows.length));
    let entitiesShownForRole = 0;

    for (const perm of permsToShow) {
      if (!seenPermissions.has(perm.permission_name)) {
        seenPermissions.add(perm.permission_name);
        const row = db.prepare(`SELECT ${PERMISSION_COLUMNS} FROM permissions WHERE permission_name = ?`).get(perm.permission_name) as
          | PermissionRow
          | undefined;
        if (row) nodes.push(toPermissionNode(row));
      }
      edges.push(edge(role.role_name, 'grants', perm.permission_name, 'grants'));

      const resources: string[] = JSON.parse(perm.resources || '[]');
      for (const resource of resources) {
        const entityId = canonicalEntityId(resource);
        if (entitiesShownForRole >= entityBudgetPerRole && !seenEntities.has(entityId)) break;
        if (!seenEntities.has(entityId)) {
          seenEntities.add(entityId);
          nodes.push(sparseEntityNode(resource, counts));
          entitiesShownForRole++;
        }
        edges.push(edge(perm.permission_name, 'touches', entityId, 'touches'));
      }
    }
  }

  return {
    view: 'role',
    endpoint: null,
    snapshot_date: null,
    focus_object: null,
    nodes,
    edges,
    total_count: totalCount,
    truncated,
  };
}

// ---------- search (search_schema_objects) ----------

/**
 * Name search across entity types, permissions, and roles for the app's search box.
 * Prefix matches rank before substring matches; each result carries a one-line `sub`
 * summary for the dropdown.
 */
export function searchSchemaObjects(
  db: DatabaseSync,
  opts: { query: string; kinds?: NodeKind[]; endpoint?: 'v1.0' | 'beta'; limit?: number },
): { results: SearchResult[] } {
  const q = opts.query.trim().toLowerCase();
  const kinds = opts.kinds ?? ['EntityType', 'Permission', 'Role'];
  const limit = opts.limit ?? 12;

  const prefix: SearchResult[] = [];
  const substring: SearchResult[] = [];
  const add = (name: string, result: SearchResult) => {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) prefix.push(result);
    else if (lower.includes(q)) substring.push(result);
  };

  if (kinds.includes('EntityType')) {
    const snapshot = loadLatestSnapshot(opts.endpoint ?? 'v1.0');
    for (const [fq, et] of Object.entries(snapshot?.entityTypes ?? {})) {
      const shortName = stripNamespace(fq);
      add(shortName, {
        id: shortName.toLowerCase(),
        kind: 'EntityType',
        label: shortName,
        sub: `Entity type · ${Object.keys(et.properties ?? {}).length} properties`,
      });
    }
  }

  if (kinds.includes('Permission')) {
    const rows = db.prepare('SELECT permission_name, admin_consent_required_app, admin_consent_required_delegated, resources FROM permissions').all() as Array<{
      permission_name: string;
      admin_consent_required_app: number | null;
      admin_consent_required_delegated: number | null;
      resources: string;
    }>;
    for (const row of rows) {
      const consent = row.admin_consent_required_app || row.admin_consent_required_delegated ? 'admin consent' : 'user consent';
      add(row.permission_name, {
        id: row.permission_name,
        kind: 'Permission',
        label: row.permission_name,
        sub: `Permission · ${consent} · touches ${JSON.parse(row.resources || '[]').length}`,
      });
    }
  }

  if (kinds.includes('Role')) {
    const rows = db.prepare('SELECT role_name, template_id, is_privileged, actions FROM roles').all() as Array<{
      role_name: string;
      template_id: string;
      is_privileged: number;
      actions: string | null;
    }>;
    const grantCounts = db.prepare('SELECT role_template_id, COUNT(*) c FROM role_permission_map GROUP BY role_template_id').all() as Array<{
      role_template_id: string;
      c: number;
    }>;
    const grantCountMap = new Map(grantCounts.map((r) => [r.role_template_id, r.c]));
    for (const row of rows) {
      const grants = grantCountMap.get(row.template_id) ?? 0;
      const actionCount = (JSON.parse(row.actions || '[]') as unknown[]).length;
      const detail = actionCount === 0 ? 'no published actions — managed outside Entra' : `grants ${grants} permissions`;
      add(row.role_name, {
        id: row.role_name,
        kind: 'Role',
        label: row.role_name,
        sub: `Role${row.is_privileged ? ' · privileged' : ''} · ${detail}`,
      });
    }
  }

  return { results: [...prefix, ...substring].slice(0, limit) };
}
