import type { ComponentType } from "react";
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Props = Record<string, JsonValue>;
export interface FieldSchema {
  type: "string" | "number" | "boolean" | "select" | "json";
  label?: string;
  options?: string[];
  min?: number;
  max?: number;
}
export interface Fixture {
  name: string;
  props: Props;
  slots?: Record<string, string>;
}
export interface ComponentMetadata {
  name: string;
  category?: string;
  slots?: string[];
  description?: string;
  fields: Record<string, FieldSchema>;
  defaultProps: Props;
  fixtures: Fixture[];
  variants?: string[];
  states?: string[];
  support?: "rendered" | "requires-context";
}
export interface ComponentDefinition extends ComponentMetadata {
  render: ComponentType<Props>;
}
export const LIBRARY_SDK_VERSION = 1;
export interface LibraryCapabilities {
  jsonProps: true;
  tokenRefs: boolean;
  slots?: boolean;
}
export interface LibraryMigration {
  fromVersion: string;
  toVersion: string;
  renameTypes?: Record<string, string>;
  renameProps?: Record<string, Record<string, string>>;
}
export interface LibraryMetadata {
  sdkVersion?: number;
  capabilities?: LibraryCapabilities;
  migrations?: LibraryMigration[];
  id: string;
  version: string;
  name: string;
  components: Record<string, ComponentMetadata>;
  themes: {
    id: string;
    name: string;
    className?: string;
    attributes?: Record<string, string>;
  }[];
  tokens: {
    name: string;
    value: string;
    source: string;
    category: string;
    themes?: Record<string, string>;
  }[];
  exports?: {
    name: string;
    kind: "component" | "utility" | "hook" | "constant";
  }[];
}
export interface ComponentLibrary extends Omit<LibraryMetadata, "components"> {
  components: Record<string, ComponentDefinition>;
}
export interface ComponentReference {
  libraryId: string;
  libraryVersion: string;
  type: string;
}
export function libraryMetadata(library: ComponentLibrary): LibraryMetadata {
  const components = Object.fromEntries(
    Object.entries(library.components).map(
      ([key, { render: _render, ...metadata }]) => [key, metadata],
    ),
  );
  return JSON.parse(
    JSON.stringify({ ...library, components }),
  ) as LibraryMetadata;
}
export class LibraryRegistry {
  constructor(public readonly libraries: readonly ComponentLibrary[]) {
    for (const library of libraries) validateLibraryMetadata(library);
    const keys = libraries.map((x) => `${x.id}@${x.version}`);
    if (new Set(keys).size !== keys.length)
      throw new Error("Duplicate library id and version");
  }
  resolve(reference: ComponentReference): {
    reference: ComponentReference;
    component?: ComponentDefinition;
    diagnostic?: { code: string; message: string };
  } {
    const candidates = this.libraries.filter(
      (x) => x.id === reference.libraryId,
    );
    const library = candidates.find(
      (x) => x.version === reference.libraryVersion,
    );
    const component = library?.components[reference.type];
    if (component) return { reference, component };
    const code =
      candidates.length === 0
        ? "library-unavailable"
        : !library
          ? "library-version-unavailable"
          : "component-unavailable";
    return {
      reference,
      diagnostic: {
        code,
        message: `Unavailable component ${reference.libraryId}@${reference.libraryVersion}/${reference.type}. Reference preserved.`,
      },
    };
  }
}

export function validateLibraryProps(
  component: ComponentMetadata,
  props: Record<string, unknown>,
): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  for (const [name, field] of Object.entries(component.fields)) {
    const value = props[name];
    if (value === undefined || value === null || field.type === "json")
      continue;
    if (
      field.type === "select"
        ? typeof value !== "string" || !field.options?.includes(value)
        : typeof value !== field.type
    )
      errors.push({
        field: name,
        message: `Expected ${field.type}${field.options ? " (" + field.options.join(", ") + ")" : ""}`,
      });
    else if (
      typeof value === "number" &&
      ((field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max))
    )
      errors.push({ field: name, message: "Value outside field range" });
  }
  return errors;
}
export interface CoreToken {
  type: "color" | "number" | "dimension" | "string" | "fontFamily";
  value: JsonValue | { $token: string };
  themes?: Record<string, JsonValue | { $token: string }>;
}
export function toCoreTokens(
  metadata: LibraryMetadata,
): Record<string, CoreToken> {
  const tokens = new Map(
    metadata.tokens.map((token) => [token.name.replace(/^--/, ""), token]),
  );
  const aliasOf = (value: string) =>
    value.match(/^var\((--[\w-]+)\)$/)?.[1].slice(2);
  const infer = (
    key: string,
    visited = new Set<string>(),
  ): CoreToken["type"] => {
    const token = tokens.get(key);
    if (!token || visited.has(key)) return "string";
    const alias = aliasOf(token.value);
    if (alias && tokens.has(alias))
      return infer(alias, new Set([...visited, key]));
    const values = [token.value, ...Object.values(token.themes ?? {})];
    if (
      values.every((v) =>
        /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|(?:rgb|hsl)a?\([\d\s.,%/-]+\)|transparent|currentcolor|black|white)$/i.test(
          v,
        ),
      )
    )
      return "color";
    if (values.every((v) => /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/.test(v)))
      return "dimension";
    if (token.category === "fontFamily") return "fontFamily";
    return "string";
  };
  const convert = (value: string): JsonValue | { $token: string } => {
    const alias = aliasOf(value);
    return alias && tokens.has(alias) ? { $token: alias } : value;
  };
  return Object.fromEntries(
    [...tokens].map(([key, token]) => [
      key,
      {
        type: infer(key),
        value: convert(token.value),
        ...(token.themes && Object.keys(token.themes).length
          ? {
              themes: Object.fromEntries(
                Object.entries(token.themes).map(([mode, value]) => [
                  mode,
                  convert(value),
                ]),
              ),
            }
          : {}),
      },
    ]),
  );
}

export function validateLibraryMetadata(
  input: unknown,
): asserts input is LibraryMetadata {
  const library = input as LibraryMetadata;
  if (
    !library ||
    typeof library !== "object" ||
    (library.sdkVersion !== undefined &&
      library.sdkVersion !== LIBRARY_SDK_VERSION)
  )
    throw new Error(`Unsupported library SDK: ${library?.sdkVersion}`);
  if (
    !library.id ||
    typeof library.id !== "string" ||
    !library.version ||
    typeof library.version !== "string" ||
    typeof library.name !== "string" ||
    !library.components ||
    typeof library.components !== "object" ||
    Array.isArray(library.components) ||
    !Array.isArray(library.themes) ||
    !Array.isArray(library.tokens)
  )
    throw new Error("Invalid library metadata");
  if (
    library.capabilities &&
    (library.capabilities.jsonProps !== true ||
      typeof library.capabilities.tokenRefs !== "boolean" ||
      (library.capabilities.slots !== undefined &&
        typeof library.capabilities.slots !== "boolean"))
  )
    throw new Error("Unsupported library capabilities");
  for (const [name, component] of Object.entries(library.components)) {
    if (
      !name ||
      !component ||
      typeof component.name !== "string" ||
      !component.fields ||
      typeof component.fields !== "object" ||
      !component.defaultProps ||
      !Array.isArray(component.fixtures)
    )
      throw new Error(`Invalid component descriptor: ${name}`);
    if (
      component.slots &&
      (!Array.isArray(component.slots) ||
        component.slots.some((slot) => typeof slot !== "string" || !slot) ||
        new Set(component.slots).size !== component.slots.length)
    )
      throw new Error(`Invalid component slots: ${name}`);
    for (const field of Object.values(component.fields))
      if (
        !["string", "number", "boolean", "select", "json"].includes(
          field.type,
        ) ||
        (field.type === "select" && !Array.isArray(field.options))
      )
        throw new Error(`Invalid component field schema: ${name}`);
  }
  for (const migration of library.migrations ?? []) {
    if (
      typeof migration.fromVersion !== "string" ||
      typeof migration.toVersion !== "string" ||
      Object.keys(migration).some(
        (k) =>
          !["fromVersion", "toVersion", "renameTypes", "renameProps"].includes(
            k,
          ),
      )
    )
      throw new Error("Invalid declarative library migration");
    for (const mapping of [
      migration.renameTypes ?? {},
      ...Object.values(migration.renameProps ?? {}),
    ])
      for (const [key, value] of Object.entries(mapping))
        if (
          !key ||
          typeof value !== "string" ||
          !value ||
          ["__proto__", "prototype", "constructor"].includes(key) ||
          ["__proto__", "prototype", "constructor"].includes(value)
        )
          throw new Error("Invalid declarative library migration mapping");
  }
}
export function bindLibraryManifest(
  library: ComponentLibrary,
  metadata: LibraryMetadata,
): ComponentLibrary {
  validateLibraryMetadata(library);
  validateLibraryMetadata(metadata);
  if (library.id !== metadata.id || library.version !== metadata.version)
    throw new Error(
      "Library runtime identity does not match its operator manifest",
    );
  const components: ComponentLibrary["components"] = {};
  for (const [name, component] of Object.entries(metadata.components)) {
    const render = library.components[name]?.render;
    if (typeof render !== "function")
      throw new Error(`Missing library runtime renderer: ${name}`);
    components[name] = { ...component, render };
  }
  return { ...metadata, components };
}
// Pure JSON transformation: applications must explicitly invoke and save a migration.
// Registry lookup never migrates or rewrites an unknown reference.
export function applyLibraryMigration(
  document: JsonValue,
  metadata: LibraryMetadata,
  toVersion: string,
): JsonValue {
  validateLibraryMetadata(metadata);
  const output = JSON.parse(JSON.stringify(document)) as Record<
    string,
    JsonValue
  >;
  const identity = output.library as Record<string, JsonValue>;
  if (
    !identity ||
    identity.id !== metadata.id ||
    typeof identity.version !== "string"
  )
    throw new Error("Document library identity does not match migration");
  const migration = metadata.migrations?.find(
    (m) => m.fromVersion === identity.version && m.toVersion === toVersion,
  );
  if (!migration)
    throw new Error(
      `No declared migration from ${identity.version} to ${toVersion}`,
    );
  function visit(value: JsonValue): void {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, JsonValue>;
    if (
      typeof node.type === "string" &&
      node.props &&
      typeof node.props === "object" &&
      !Array.isArray(node.props)
    ) {
      node.type = migration!.renameTypes?.[node.type] ?? node.type;
      const props = node.props as Record<string, JsonValue>;
      for (const [from, to] of Object.entries(
        migration!.renameProps?.[node.type] ?? {},
      )) {
        if (!Object.hasOwn(props, from)) continue;
        if (from !== to && Object.hasOwn(props, to))
          throw new Error(`Migration property conflict: ${from} -> ${to}`);
        props[to] = props[from];
        if (from !== to) delete props[from];
      }
    }
    if (node.nodes) visit(node.nodes);
    if (node.slots)
      for (const children of Object.values(
        node.slots as Record<string, JsonValue>,
      ))
        visit(children);
  }
  visit(output.pages ?? []);
  identity.version = toVersion;
  return output;
}
