/**
 * Base attributes Map for elements that share state across planning and
 * resolution. Both `ExecutionScope` and `ExecutionField` extend this.
 */
export abstract class HasAttributes {
  private _attributes: Map<unknown, unknown> | null = null;

  get attributes(): Map<unknown, unknown> {
    if (!this._attributes) this._attributes = new Map();
    return this._attributes;
  }

  attribute(key: unknown, defaultValue: unknown = null): unknown {
    if (!this._attributes) return defaultValue;
    return this._attributes.has(key) ? this._attributes.get(key) : defaultValue;
  }

  hasAttribute(key: unknown): boolean {
    return this._attributes ? this._attributes.has(key) : false;
  }
}
