// ============================================
// Agent Spec references: every component by id, wherever it is written
// ============================================
// A component may be written inline or as {"$component_ref": id} pointing into
// a $referenced_components map at its own level or any level above it. The
// index records each component with the JSON Pointer it is written at, so an
// error about it points at the text.

import { issue, pointer, type FormatIssue } from "../model.js";

export type Json = Record<string, unknown>;

export interface Indexed {
  component: Json;
  path: string;
}

export class ComponentIndex {
  readonly byId = new Map<string, Indexed>();
  readonly issues: FormatIssue[] = [];

  constructor(root: Json) {
    this.walk(root, "");
  }

  private walk(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, i) => this.walk(item, `${path}/${i}`));
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Json;
    if (typeof obj.component_type === "string" && typeof obj.id === "string") {
      const seen = this.byId.get(obj.id);
      if (seen && seen.component !== obj) {
        this.issues.push(issue(`${path}/id`, `the id "${obj.id}" is already used at ${seen.path}; Agent Spec ids are unique`));
      } else {
        this.byId.set(obj.id, { component: obj, path });
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === "metadata") continue;
      this.walk(value, `${path}${pointer(key)}`);
    }
  }

  isRef(value: unknown): value is { $component_ref: string } {
    return !!value && typeof value === "object" && typeof (value as Json).$component_ref === "string";
  }

  /** The component a value is: itself when inline, the referenced one otherwise. */
  resolve(value: unknown, path: string): Indexed | null {
    if (this.isRef(value)) {
      const found = this.byId.get(value.$component_ref);
      if (!found) {
        this.issues.push(issue(`${path}/$component_ref`, `no component has the id "${value.$component_ref}"`));
        return null;
      }
      return found;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) return { component: value as Json, path };
    this.issues.push(issue(path, "expected a component or a $component_ref"));
    return null;
  }

  idOf(value: unknown): string | undefined {
    if (this.isRef(value)) return value.$component_ref;
    if (value && typeof value === "object" && typeof (value as Json).id === "string") return (value as Json).id as string;
    return undefined;
  }
}

/** Titles of a component's input or output properties. */
export function titles(list: unknown): string[] {
  return Array.isArray(list) ? list.map((p) => String((p as Json)?.title ?? "")).filter(Boolean) : [];
}

/** The names a template's {{placeholders}} declare, as Agent Spec infers inputs from them. */
export function placeholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) out.add(m[1]);
  return [...out];
}
