import type { DatabaseSync } from 'node:sqlite';

interface PermissionRow {
  permission_name: string;
  app_identifier: string | null;
  delegated_identifier: string | null;
  display_text: string | null;
  admin_consent_required_app: number | null;
  admin_consent_required_delegated: number | null;
  graph_endpoints: string;
  resources: string;
  combined_with: string | null;
}

export interface PermissionContext {
  permission_name: string;
  app_identifier: string | null;
  delegated_identifier: string | null;
  display_text: string | null;
  admin_consent_required: boolean;
  graph_endpoints: string[];
  graph_endpoints_total_count: number;
  graph_endpoints_truncated: boolean;
  combined_with: string[] | null;
  grantable_by: string[];
}

// Broad permissions can list 300+ endpoints (Directory.ReadWrite.All has ~400) — one MCP tool
// response returning the full list for many permissions at once produced a 417KB payload in
// testing (get_permission_context for object_name="user", 192 matching permissions), which is
// almost certainly what caused a real MCP transport disconnect a user hit. Cap per-permission
// endpoints to a sample with a total count instead of silently dropping the information.
const MAX_ENDPOINTS_PER_PERMISSION = 10;
const MAX_PERMISSIONS_PER_QUERY = 25;

function pluralize(name: string): string {
  if (/[sxz]$|[cs]h$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sampleEndpoints(endpoints: string[]): Pick<PermissionContext, 'graph_endpoints' | 'graph_endpoints_total_count' | 'graph_endpoints_truncated'> {
  return {
    graph_endpoints: endpoints.slice(0, MAX_ENDPOINTS_PER_PERMISSION),
    graph_endpoints_total_count: endpoints.length,
    graph_endpoints_truncated: endpoints.length > MAX_ENDPOINTS_PER_PERMISSION,
  };
}

function toPermissionContext(db: DatabaseSync, row: PermissionRow, endpoints: string[]): PermissionContext {
  const roleLookupStmt = db.prepare(`
    SELECT r.role_name FROM role_permission_map m
    JOIN roles r ON r.template_id = m.role_template_id
    WHERE m.permission_name = ?
    ORDER BY r.role_name
  `);

  return {
    permission_name: row.permission_name,
    app_identifier: row.app_identifier,
    delegated_identifier: row.delegated_identifier,
    display_text: row.display_text,
    admin_consent_required: Boolean(row.admin_consent_required_app || row.admin_consent_required_delegated),
    ...sampleEndpoints(endpoints),
    combined_with: row.combined_with ? JSON.parse(row.combined_with) : null,
    grantable_by: (roleLookupStmt.all(row.permission_name) as Array<{ role_name: string }>).map((r) => r.role_name),
  };
}

/**
 * Permissions whose `resources` list includes objectName, enriched with grantable_by roles
 * (PRD §6.5/§6.7). Shared by get_permission_context and get_change_detail so both tools stay
 * consistent — see README known limitations re: the role<->permission heuristic.
 *
 * Results are capped at MAX_PERMISSIONS_PER_QUERY, sorted by resource_count ascending (fewer
 * total resources = more specific to this object) so the narrowest, most relevant permissions
 * survive the cut rather than an arbitrary (e.g. alphabetical) slice burying them behind
 * mega-broad ones like Directory.ReadWrite.All.
 */
export function getPermissionsForObject(
  db: DatabaseSync,
  objectName: string,
  opts: { permissionName?: string; limit?: number } = {},
): { permissions: PermissionContext[]; total_matching_count: number } {
  const objectLower = objectName.toLowerCase();
  const objectPlural = pluralize(objectLower);
  const limit = Math.min(opts.limit ?? MAX_PERMISSIONS_PER_QUERY, 50);

  const conditions = ['lower(resources) LIKE ?'];
  const params: unknown[] = [`%"${objectLower}"%`];
  if (opts.permissionName) {
    conditions.push('permission_name = ?');
    params.push(opts.permissionName);
  }

  const rows = db
    .prepare(`SELECT * FROM permissions WHERE ${conditions.join(' AND ')}`)
    .all(...(params as never[])) as unknown as PermissionRow[];

  const withResourceCount = rows.map((row) => ({ row, resourceCount: (JSON.parse(row.resources || '[]') as string[]).length }));
  withResourceCount.sort((a, b) => a.resourceCount - b.resourceCount || a.row.permission_name.localeCompare(b.row.permission_name));

  const permissions = withResourceCount.slice(0, limit).map(({ row }) => {
    const allEndpoints: string[] = JSON.parse(row.graph_endpoints || '[]');
    const filtered = allEndpoints.filter((e) => e.toLowerCase().includes(objectLower) || e.toLowerCase().includes(objectPlural));
    return toPermissionContext(db, row, filtered.length > 0 ? filtered : allEndpoints);
  });

  return { permissions, total_matching_count: rows.length };
}

export interface RelatedPermission {
  permission_name: string;
  display_text: string | null;
  resource_count: number;
  admin_consent_required: boolean;
  is_ownership_scoped: boolean;
  resource_overlap: number;
}

/**
 * For a known permission, find others touching an overlapping set of resources — for
 * "what's a less-privileged alternative to X" questions (PRD §6.7's "combined permissions"
 * angle, extended). Deliberately does NOT rank or claim to compute "least privilege" — resource
 * COUNT isn't the only privilege axis. E.g. Application.ReadWrite.OwnedBy touches ~60 resource
 * types (more than Synchronization.ReadWrite.All's ~13) while still being the documented
 * lower-privilege choice for provisioning automation, because it scopes to owned objects only —
 * an instance-level restriction this data can't see. `is_ownership_scoped` (derived from the
 * permission name containing "OwnedBy") is surfaced as an honest, verifiable signal instead of
 * a fabricated privilege score — the caller should reason over these fields, not treat sort
 * order as a recommendation.
 */
export function getRelatedPermissions(db: DatabaseSync, permissionName: string): { target: PermissionContext; related: RelatedPermission[] } | null {
  const targetRow = db.prepare('SELECT * FROM permissions WHERE permission_name = ?').get(permissionName) as PermissionRow | undefined;
  if (!targetRow) return null;
  const target = toPermissionContext(db, targetRow, JSON.parse(targetRow.graph_endpoints || '[]'));
  const targetResources = new Set<string>(JSON.parse(targetRow.resources ?? '[]'));

  const others = db
    .prepare('SELECT permission_name, display_text, resources, admin_consent_required_app, admin_consent_required_delegated FROM permissions WHERE permission_name != ?')
    .all(permissionName) as Array<{
      permission_name: string;
      display_text: string | null;
      resources: string;
      admin_consent_required_app: number | null;
      admin_consent_required_delegated: number | null;
    }>;

  const related = others
    .map((row) => {
      const resources: string[] = JSON.parse(row.resources || '[]');
      const overlap = jaccard(targetResources, new Set(resources));
      return {
        permission_name: row.permission_name,
        display_text: row.display_text,
        resource_count: resources.length,
        admin_consent_required: Boolean(row.admin_consent_required_app || row.admin_consent_required_delegated),
        is_ownership_scoped: /ownedby/i.test(row.permission_name),
        resource_overlap: Math.round(overlap * 100) / 100,
      };
    })
    .filter((r) => r.resource_overlap > 0.2)
    .sort((a, b) => b.resource_overlap - a.resource_overlap || a.resource_count - b.resource_count);

  return { target, related: related.slice(0, 15) };
}
