// Parses Microsoft Graph $metadata CSDL XML into a structured JSON snapshot, covering the
// elements enumerated in PRD §7.1: EntityType, Property, NavigationProperty, EnumType/Member,
// Annotation, ComplexType, EntitySet, Singleton, Function/Action, FunctionImport/ActionImport.
import { XMLParser } from 'fast-xml-parser';

const ARRAY_TAGS = new Set([
  'Schema', 'EntityType', 'ComplexType', 'EnumType', 'Member', 'Property', 'NavigationProperty',
  'Function', 'Action', 'Parameter', 'EntitySet', 'Singleton', 'FunctionImport', 'ActionImport',
  'Annotation', 'NavigationPropertyBinding',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function parseProperty(p) {
  return {
    name: p['@_Name'],
    type: p['@_Type'],
    nullable: p['@_Nullable'] !== 'false',
  };
}

function parseNavProp(np) {
  return {
    name: np['@_Name'],
    type: np['@_Type'],
    containsTarget: np['@_ContainsTarget'] === 'true',
  };
}

function parseEntityOrComplexType(t) {
  return {
    baseType: t['@_BaseType'] ?? null,
    abstract: t['@_Abstract'] === 'true',
    openType: t['@_OpenType'] === 'true',
    hasStream: t['@_HasStream'] === 'true',
    properties: Object.fromEntries(asArray(t.Property).map((p) => [p['@_Name'], parseProperty(p)])),
    navigationProperties: Object.fromEntries(asArray(t.NavigationProperty).map((np) => [np['@_Name'], parseNavProp(np)])),
  };
}

function parseEnumType(e) {
  return {
    isFlags: e['@_IsFlags'] === 'true',
    underlyingType: e['@_UnderlyingType'] ?? 'Edm.Int32',
    members: Object.fromEntries(asArray(e.Member).map((m) => [m['@_Name'], m['@_Value']])),
  };
}

function overloadKey(fn) {
  const params = asArray(fn.Parameter).map((p) => p['@_Type']).join(',');
  return `${fn['@_Name']}(${params})`;
}

function parseFunctionOrAction(fn) {
  return {
    isBound: fn['@_IsBound'] === 'true',
    isComposable: fn['@_IsComposable'] === 'true',
    entitySetPath: fn['@_EntitySetPath'] ?? null,
    returnType: fn.ReturnType?.['@_Type'] ?? null,
    parameters: asArray(fn.Parameter).map((p) => ({ name: p['@_Name'], type: p['@_Type'] })),
  };
}

export function parseCsdl(xml, { version, fetchedAt } = {}) {
  const doc = parser.parse(xml);
  const schemas = asArray(doc['edmx:Edmx']?.['edmx:DataServices']?.Schema);

  const snapshot = {
    version: version ?? null,
    fetchedAt: fetchedAt ?? new Date().toISOString(),
    entityTypes: {},
    complexTypes: {},
    enumTypes: {},
    entitySets: {},
    singletons: {},
    functions: {},
    actions: {},
    functionImports: {},
    actionImports: {},
  };

  for (const schema of schemas) {
    const ns = schema['@_Namespace'];

    for (const t of asArray(schema.EntityType)) {
      snapshot.entityTypes[`${ns}.${t['@_Name']}`] = parseEntityOrComplexType(t);
    }
    for (const t of asArray(schema.ComplexType)) {
      snapshot.complexTypes[`${ns}.${t['@_Name']}`] = parseEntityOrComplexType(t);
    }
    for (const e of asArray(schema.EnumType)) {
      snapshot.enumTypes[`${ns}.${e['@_Name']}`] = parseEnumType(e);
    }
    for (const fn of asArray(schema.Function)) {
      snapshot.functions[`${ns}.${overloadKey(fn)}`] = parseFunctionOrAction(fn);
    }
    for (const act of asArray(schema.Action)) {
      snapshot.actions[`${ns}.${overloadKey(act)}`] = parseFunctionOrAction(act);
    }

    for (const container of asArray(schema.EntityContainer)) {
      for (const es of asArray(container.EntitySet)) {
        snapshot.entitySets[es['@_Name']] = es['@_EntityType'];
      }
      for (const s of asArray(container.Singleton)) {
        snapshot.singletons[s['@_Name']] = s['@_Type'];
      }
      for (const fi of asArray(container.FunctionImport)) {
        snapshot.functionImports[fi['@_Name']] = fi['@_Function'];
      }
      for (const ai of asArray(container.ActionImport)) {
        snapshot.actionImports[ai['@_Name']] = ai['@_Action'];
      }
    }
  }

  return snapshot;
}

export function summarize(snapshot) {
  const enumValueCount = Object.values(snapshot.enumTypes).reduce((sum, e) => sum + Object.keys(e.members).length, 0);
  return {
    entity_count: Object.keys(snapshot.entityTypes).length,
    property_count:
      Object.values(snapshot.entityTypes).reduce((sum, t) => sum + Object.keys(t.properties).length, 0) +
      Object.values(snapshot.complexTypes).reduce((sum, t) => sum + Object.keys(t.properties).length, 0),
    enum_count: Object.keys(snapshot.enumTypes).length,
    enum_value_count: enumValueCount,
  };
}
