// Diffs two parsed CSDL snapshots (see parse-csdl.js) of the same endpoint and produces change
// records matching the `changes` table schema, with source='self' (PRD §7.2).
const stripNamespace = (name) => name.replace(/^microsoft\.graph\./, '');

function baseRow(endpoint, objectType, objectName) {
  return {
    endpoint,
    object_type: objectType,
    object_name: stripNamespace(objectName),
    property_name: null,
    change_kind: 'modified',
    change_target: 'property',
    old_value: null,
    new_value: null,
    old_type: null,
    new_type: null,
    description: '',
    raw_diff: null,
  };
}

function diffPropertyMaps(rows, endpoint, objectType, objectName, target, prevMap = {}, currMap = {}, typeField = 'type') {
  const prevKeys = new Set(Object.keys(prevMap));
  const currKeys = new Set(Object.keys(currMap));

  for (const key of currKeys) {
    if (!prevKeys.has(key)) {
      const row = baseRow(endpoint, objectType, objectName);
      row.property_name = key;
      row.change_kind = 'added';
      row.change_target = target;
      row.new_type = currMap[key][typeField] ?? null;
      row.description = `added ${key} on ${stripNamespace(objectName)} (${objectType})`;
      rows.push(row);
    }
  }
  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      const row = baseRow(endpoint, objectType, objectName);
      row.property_name = key;
      row.change_kind = 'removed';
      row.change_target = target;
      row.old_type = prevMap[key][typeField] ?? null;
      row.description = `removed ${key} on ${stripNamespace(objectName)} (${objectType})`;
      rows.push(row);
    }
  }
  for (const key of currKeys) {
    if (!prevKeys.has(key)) continue;
    const before = prevMap[key];
    const after = currMap[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const row = baseRow(endpoint, objectType, objectName);
    row.property_name = key;
    row.change_kind = 'modified';
    row.change_target = target;
    row.old_type = before[typeField] ?? null;
    row.new_type = after[typeField] ?? null;
    row.old_value = JSON.stringify(before);
    row.new_value = JSON.stringify(after);
    row.description = `modified ${key} on ${stripNamespace(objectName)} (${objectType})`;
    rows.push(row);
  }
}

function diffTypeCollection(rows, endpoint, objectType, prevTypes = {}, currTypes = {}) {
  const prevKeys = new Set(Object.keys(prevTypes));
  const currKeys = new Set(Object.keys(currTypes));

  for (const name of currKeys) {
    if (!prevKeys.has(name)) {
      const row = baseRow(endpoint, objectType, name);
      row.change_kind = 'added';
      row.change_target = 'entity_type';
      row.description = `added ${objectType} ${stripNamespace(name)}`;
      rows.push(row);
    }
  }
  for (const name of prevKeys) {
    if (!currKeys.has(name)) {
      const row = baseRow(endpoint, objectType, name);
      row.change_kind = 'removed';
      row.change_target = 'entity_type';
      row.description = `removed ${objectType} ${stripNamespace(name)}`;
      rows.push(row);
    }
  }
  for (const name of currKeys) {
    if (!prevKeys.has(name)) continue;
    const before = prevTypes[name];
    const after = currTypes[name];

    if (before.baseType !== after.baseType || before.abstract !== after.abstract || before.openType !== after.openType) {
      const row = baseRow(endpoint, objectType, name);
      row.change_kind = 'modified';
      row.change_target = 'entity_type';
      row.old_value = JSON.stringify({ baseType: before.baseType, abstract: before.abstract, openType: before.openType });
      row.new_value = JSON.stringify({ baseType: after.baseType, abstract: after.abstract, openType: after.openType });
      row.description = `modified type definition of ${stripNamespace(name)} (${objectType})`;
      rows.push(row);
    }

    diffPropertyMaps(rows, endpoint, objectType, name, 'property', before.properties, after.properties);
    diffPropertyMaps(rows, endpoint, objectType, name, 'navigation_property', before.navigationProperties, after.navigationProperties);
  }
}

function diffEnumTypes(rows, endpoint, prevEnums = {}, currEnums = {}) {
  const prevKeys = new Set(Object.keys(prevEnums));
  const currKeys = new Set(Object.keys(currEnums));

  for (const name of currKeys) {
    if (!prevKeys.has(name)) {
      const row = baseRow(endpoint, 'EnumType', name);
      row.change_kind = 'added';
      row.change_target = 'entity_type';
      row.description = `added EnumType ${stripNamespace(name)}`;
      rows.push(row);
      continue;
    }
    const before = prevEnums[name].members;
    const after = currEnums[name].members;
    const prevMembers = new Set(Object.keys(before));
    const currMembers = new Set(Object.keys(after));

    for (const m of currMembers) {
      if (!prevMembers.has(m)) {
        const row = baseRow(endpoint, 'EnumType', name);
        row.property_name = m;
        row.change_kind = 'added';
        row.change_target = 'enum_value';
        row.new_value = after[m];
        row.description = `added enum member ${m} to ${stripNamespace(name)}`;
        rows.push(row);
      }
    }
    for (const m of prevMembers) {
      if (!currMembers.has(m)) {
        const row = baseRow(endpoint, 'EnumType', name);
        row.property_name = m;
        row.change_kind = 'removed';
        row.change_target = 'enum_value';
        row.old_value = before[m];
        row.description = `removed enum member ${m} from ${stripNamespace(name)}`;
        rows.push(row);
      }
    }
  }
  for (const name of prevKeys) {
    if (!currKeys.has(name)) {
      const row = baseRow(endpoint, 'EnumType', name);
      row.change_kind = 'removed';
      row.change_target = 'entity_type';
      row.description = `removed EnumType ${stripNamespace(name)}`;
      rows.push(row);
    }
  }
}

function diffNamedMap(rows, endpoint, objectType, changeTarget, prevMap = {}, currMap = {}) {
  const prevKeys = new Set(Object.keys(prevMap));
  const currKeys = new Set(Object.keys(currMap));

  for (const name of currKeys) {
    if (!prevKeys.has(name)) {
      const row = baseRow(endpoint, objectType, name);
      row.change_kind = 'added';
      row.change_target = changeTarget;
      row.new_value = JSON.stringify(currMap[name]);
      row.description = `added ${objectType} ${name}`;
      rows.push(row);
    } else if (JSON.stringify(prevMap[name]) !== JSON.stringify(currMap[name])) {
      const row = baseRow(endpoint, objectType, name);
      row.change_kind = 'modified';
      row.change_target = changeTarget;
      row.old_value = JSON.stringify(prevMap[name]);
      row.new_value = JSON.stringify(currMap[name]);
      row.description = `modified ${objectType} ${name}`;
      rows.push(row);
    }
  }
  for (const name of prevKeys) {
    if (!currKeys.has(name)) {
      const row = baseRow(endpoint, objectType, name);
      row.change_kind = 'removed';
      row.change_target = changeTarget;
      row.old_value = JSON.stringify(prevMap[name]);
      row.description = `removed ${objectType} ${name}`;
      rows.push(row);
    }
  }
}

export function diffSnapshots(previous, current, endpoint) {
  const rows = [];
  diffTypeCollection(rows, endpoint, 'EntityType', previous.entityTypes, current.entityTypes);
  diffTypeCollection(rows, endpoint, 'ComplexType', previous.complexTypes, current.complexTypes);
  diffEnumTypes(rows, endpoint, previous.enumTypes, current.enumTypes);
  diffNamedMap(rows, endpoint, 'EntitySet', 'entity_set', previous.entitySets, current.entitySets);
  diffNamedMap(rows, endpoint, 'Singleton', 'singleton', previous.singletons, current.singletons);
  diffNamedMap(rows, endpoint, 'Function', 'function', previous.functions, current.functions);
  diffNamedMap(rows, endpoint, 'Action', 'function', previous.actions, current.actions);
  diffNamedMap(rows, endpoint, 'FunctionImport', 'function', previous.functionImports, current.functionImports);
  diffNamedMap(rows, endpoint, 'ActionImport', 'function', previous.actionImports, current.actionImports);
  return rows;
}
