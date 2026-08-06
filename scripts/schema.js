export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    object_type TEXT,
    object_name TEXT,
    property_name TEXT,
    change_kind TEXT NOT NULL,
    change_target TEXT,
    old_value TEXT,
    new_value TEXT,
    old_type TEXT,
    new_type TEXT,
    description TEXT,
    raw_diff TEXT,
    snapshot_date TEXT NOT NULL,
    source TEXT DEFAULT 'self'
);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    csdl_hash TEXT,
    entity_count INTEGER,
    property_count INTEGER,
    enum_count INTEGER,
    csdl_size_bytes INTEGER,
    change_count INTEGER DEFAULT 0,
    source TEXT DEFAULT 'self'
);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    permission_name TEXT NOT NULL UNIQUE,
    app_identifier TEXT,
    delegated_identifier TEXT,
    display_text TEXT,
    description_app TEXT,
    description_delegated TEXT,
    admin_consent_required_app INTEGER,
    admin_consent_required_delegated INTEGER,
    graph_endpoints TEXT,
    resources TEXT,
    combined_with TEXT,
    collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT NOT NULL,
    template_id TEXT UNIQUE,
    description TEXT,
    is_privileged INTEGER DEFAULT 0,
    actions TEXT,
    collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permission_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_template_id TEXT NOT NULL,
    permission_name TEXT NOT NULL,
    grant_type TEXT,
    FOREIGN KEY (role_template_id) REFERENCES roles(template_id),
    FOREIGN KEY (permission_name) REFERENCES permissions(permission_name)
);

CREATE INDEX IF NOT EXISTS idx_changes_endpoint ON changes(endpoint);
CREATE INDEX IF NOT EXISTS idx_changes_object_name ON changes(object_name);
CREATE INDEX IF NOT EXISTS idx_changes_change_kind ON changes(change_kind);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at ON changes(detected_at);
CREATE INDEX IF NOT EXISTS idx_changes_snapshot_date ON changes(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_changes_source ON changes(source);

CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(permission_name);
CREATE INDEX IF NOT EXISTS idx_permissions_resources ON permissions(resources);
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(role_name);
CREATE INDEX IF NOT EXISTS idx_role_perm_role ON role_permission_map(role_template_id);
CREATE INDEX IF NOT EXISTS idx_role_perm_perm ON role_permission_map(permission_name);
`;

export function openDb(DatabaseSync, path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  return db;
}

// text-embedding-3-small produces 1536-dimensional vectors (PRD §7.5).
export const EMBEDDING_DIMENSIONS = 1536;

// sqlite-vec ships as a loadable extension per-platform (sqlite-vec-<os>-<arch>) — node:sqlite
// can load it, but only if the database was opened with allowExtension: true.
export function openDbWithVec(DatabaseSync, sqliteVec, path, opts = {}) {
  const db = new DatabaseSync(path, { ...opts, allowExtension: true });
  db.enableLoadExtension(true);
  sqliteVec.load(db);
  db.exec(SCHEMA_SQL);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS change_embeddings USING vec0(embedding float[${EMBEDDING_DIMENSIONS}])`);
  return db;
}
