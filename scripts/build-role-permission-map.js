// Cross-references roles.actions against permissions to populate role_permission_map (PRD §6.5).
// This is a HEURISTIC correlation, not an authoritative mapping — Microsoft doesn't publish an
// official crosswalk between Entra RBAC actions (microsoft.directory/*) and OAuth permission
// scopes (User.Read.All, etc.); they're two separate authorization systems that both happen to
// govern overlapping resource types. Matching is by the permission's PRIMARY resource — derived
// from its own name (e.g. "AdministrativeUnit.Read.All" -> "administrativeUnit"), not its full
// `resources` list. The `resources` array on a broad permission can list 100+ incidental entity
// types it happens to touch; matching against all of them would link almost every admin role to
// almost every permission (verified: an earlier version of this script did exactly that — e.g.
// linking "Yammer Administrator" to "AdministrativeUnit.Read.All" purely because both roles'
// role/permission happened to also touch "user" or "group"). The permission's own name is a much
// more precise signal for "what is this permission fundamentally about."
//
// Verb matching is by OPERATION CATEGORY (read/create/update/delete/restore/enable/disable/
// invite/license/session/all), not a coarse read-vs-write binary. A binary model was tried first
// and produced two confirmed false positives in real use: "Directory Writers" (create/update/
// enable/disable actions on `users`, but no delete/restore action) appeared grantable_by for
// User.DeleteRestore.All simply because both are "write-tier" — Directory Writers cannot actually
// delete or restore users. Graph's own granular permission names (DeleteRestore,
// EnableDisableAccount, ReadUpdate, Invite, ...) are operation-specific by design; matching
// against that specificity instead of collapsing everything into read/write fixes this class of
// bug. ~83% of permissions are still plain Read/ReadWrite (any mutate action satisfies
// ReadWrite) — the category taxonomy below only needs to special-case the narrower verbs.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDb } from './schema.js';

const DB_PATH = fileURLToPath(new URL('../graph-atlas.db', import.meta.url));

function pluralize(name) {
  if (/[sxz]$|[cs]h$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

// Classifies a role's RBAC action into an operation category, based on its LAST path segment
// (e.g. "appRoleAssignments/read" -> "read"). Testing the whole verb path instead of just the
// last segment previously caused a substring false positive: a generic WRITE regex matched
// "assign" inside "appRoleAssignments", misclassifying a pure read action as a write action.
function classifyAction(action) {
  const m = action.match(/^microsoft\.directory\/([a-zA-Z.]+)\/(.+)$/);
  if (!m) return null;
  const [, resourceSegment, verbPath] = m;
  const s = verbPath.split('/').pop();

  let category;
  if (/^read$/i.test(s)) category = 'read';
  else if (/^create/i.test(s)) category = 'create'; // prefix: catches createAsOwner, createAsMember
  else if (/^update$/i.test(s)) category = 'update';
  else if (/^delete$/i.test(s)) category = 'delete';
  else if (/^restore$/i.test(s)) category = 'restore';
  else if (/^enable$/i.test(s)) category = 'enable';
  else if (/^disable$/i.test(s)) category = 'disable';
  else if (/^invite/i.test(s)) category = 'invite';
  else if (/^(assignlicense|reprocesslicenseassignment)$/i.test(s)) category = 'license';
  else if (/^(invalidateallrefreshtokens|revokesigninsessions)$/i.test(s)) category = 'session';
  else if (/^alltasks$/i.test(s)) category = 'all'; // Entra RBAC's full-control convention
  else category = 'other';

  // resourceSegment can be dotted (e.g. "groups.unified", "deletedItems.users") — index on the
  // first segment only.
  return { resourceKey: resourceSegment.split('.')[0].toLowerCase(), category };
}

// Graph permission naming is {Resource}.{Verb}.{Scope}. Maps the verb segment to the set of
// action categories that satisfy it. Unrecognized/long-tail verbs (ReadWrite, Write, Manage,
// FullControl, and ~75 rarer Teams/Chat-specific variants) fall back to "any mutate category",
// matching their broad, non-operation-specific intent.
const ANY_MUTATE = ['create', 'update', 'delete', 'restore', 'enable', 'disable', 'invite', 'license', 'session', 'all'];
const VERB_REQUIREMENTS = {
  create: ['create', 'all'],
  createasmanager: ['create', 'all'],
  createfromownedtemplate: ['create', 'all'],
  readupdate: ['update', 'all'],
  delete: ['delete', 'restore', 'all'],
  deleterestore: ['delete', 'restore', 'all'],
  managedeletion: ['delete', 'restore', 'all'],
  enabledisable: ['enable', 'disable', 'all'],
  enabledisableaccount: ['enable', 'disable', 'all'],
  invite: ['invite', 'all'],
  assignlicenses: ['license', 'all'],
  revokesessions: ['session', 'all'],
  manageidentities: ['update', 'all'],
};

function permissionRequiredCategories(permissionName) {
  const verbSegment = (permissionName.split('.')[1] ?? '').toLowerCase();
  if (VERB_REQUIREMENTS[verbSegment]) return VERB_REQUIREMENTS[verbSegment];
  // General fallback for anything not explicitly bucketed above: verb segments starting with
  // "read" that don't also mention "write" are read-only (ReadForChat, ReadSelectedForTeam,
  // ReadAnonymous, ReadApprove, ReadBasic, ...) — everything else (ReadWrite, Write, Manage,
  // FullControl, Send, ...) is broad and requires an actual mutate-type action, not just read.
  if (/^read/i.test(verbSegment) && !/write/i.test(verbSegment)) return ['read', 'all'];
  return ANY_MUTATE;
}

// "AdministrativeUnit.Read.All" -> "administrativeunit", "AccessReview.ReadWrite.All" -> "accessreview".
// Standard Graph permission naming is {Resource}.{Verb}.{Scope} — the first segment is the resource.
function permissionPrimaryResource(permissionName) {
  return permissionName.split('.')[0].toLowerCase();
}

function main() {
  const db = openDb(DatabaseSync, DB_PATH);

  const roles = db.prepare('SELECT template_id, actions FROM roles').all();
  const permissions = db.prepare('SELECT permission_name FROM permissions').all();
  console.log(`Cross-referencing ${roles.length} roles against ${permissions.length} permissions...`);

  // Index: normalized plural resource key -> [{ template_id, category }]
  const roleIndex = new Map();
  for (const role of roles) {
    let actions;
    try {
      actions = JSON.parse(role.actions ?? '[]');
    } catch {
      continue;
    }
    for (const action of actions) {
      const classified = classifyAction(action);
      if (!classified) continue;
      const list = roleIndex.get(classified.resourceKey) ?? [];
      list.push({ template_id: role.template_id, category: classified.category });
      roleIndex.set(classified.resourceKey, list);
    }
  }

  db.exec('DELETE FROM role_permission_map');
  const insertStmt = db.prepare('INSERT INTO role_permission_map (role_template_id, permission_name, grant_type) VALUES (?, ?, ?)');

  let linked = 0;
  for (const perm of permissions) {
    const required = permissionRequiredCategories(perm.permission_name);
    const key = pluralize(permissionPrimaryResource(perm.permission_name));
    const matches = roleIndex.get(key);
    if (!matches) continue;

    const seen = new Set(); // dedupe role_template_id within this permission
    for (const { template_id, category } of matches) {
      if (!required.includes(category) || seen.has(template_id)) continue;
      seen.add(template_id);
      insertStmt.run(template_id, perm.permission_name, category);
      linked++;
    }
  }

  console.log(`Done. Created ${linked} role<->permission links.`);
  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
