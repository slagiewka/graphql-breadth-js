import { ImplementationError, MethodNotImplementedError } from "./errors";
import { ExecutionPromise, Deferred } from "./executor/execution_promise";
import type { ExecutionField } from "./executor/execution_field";

const KEY_OMISSION: unique symbol = Symbol("KEY_OMISSION");
type KeyOmission = typeof KEY_OMISSION;

class LazyFulfillment {
  field: ExecutionField;
  keys: unknown[];
  identities: Array<unknown | KeyOmission>;
  eagers: Map<unknown, unknown> | null;
  promise: ExecutionPromise<unknown[]>;
  private resolver!: (value: unknown[] | ExecutionPromise<unknown[]>) => void;

  constructor(options: {
    field: ExecutionField;
    keys: unknown[];
    identities: Array<unknown | KeyOmission>;
    eagers?: Map<unknown, unknown> | null;
    preDeferred?: Deferred<unknown[]> | null;
  }) {
    this.field = options.field;
    this.keys = options.keys;
    this.identities = options.identities;
    this.eagers = options.eagers ?? null;
    if (options.preDeferred) {
      this.promise = options.preDeferred.promise;
      this.resolver = options.preDeferred.resolver;
    } else {
      this.promise = new ExecutionPromise<unknown[]>((resolve) => {
        this.resolver = resolve;
      });
    }
  }

  resolve(results: unknown[]): void {
    this.resolver(results);
  }
}

export interface LazyLoaderConstructor {
  new (args?: Record<string, unknown>): LazyLoader;
}

/**
 * A breadth-native dataloader pattern. Always enqueues a _set_ of keys
 * (versus keys requested individually), and binds the complete keyset
 * to a single promise. Eliminates promise bloat across list fields that
 * share common I/O operations. Results in a promise _per document selection_
 * rather than one _per field instance_.
 */
export abstract class LazyLoader<Ctx = unknown> {
  pendingKeysByIdentity: Map<unknown, unknown> = new Map();
  resultsByIdentity: Map<unknown, unknown> = new Map();
  promised: LazyFulfillment[] = [];

  // When `map === true`, `performMap` returns the result array in 1:1 order with pending keys.
  // When `map === false`, `perform` fills results via `fulfillKey`/`fulfillIdentity`.
  map = false;

  perform(_keys: unknown[], _context: Ctx): void {
    throw new MethodNotImplementedError(
      "LazyLoader#perform must be implemented",
    );
  }

  performMap(_keys: unknown[], _context: Ctx): unknown[] {
    throw new MethodNotImplementedError(
      "LazyLoader#performMap must be implemented",
    );
  }

  identityFor(key: unknown): unknown {
    return key;
  }

  fulfillKey(key: unknown, result: unknown): void {
    this.resultsByIdentity.set(this.identityFor(key), result);
  }

  fulfillIdentity(identity: unknown, result: unknown): void {
    this.resultsByIdentity.set(identity, result);
  }

  load(options: {
    field: ExecutionField;
    keys: unknown[];
    eager?: Map<unknown, unknown> | null;
    loadNilKeys?: boolean;
    preDeferred?: Deferred<unknown[]> | null;
  }): ExecutionPromise<unknown[]> {
    let eager = options.eager ?? null;
    if (eager && eager.size === 0) eager = null;
    const compact = !options.loadNilKeys;
    const pending = this.pendingKeysByIdentity;
    const results = this.resultsByIdentity;

    const identities: Array<unknown | KeyOmission> = options.keys.map((key) => {
      if ((compact && key == null) || (eager && eager.has(key))) {
        return KEY_OMISSION;
      }
      const identity = this.identityFor(key);
      if (!results.has(identity) && !pending.has(identity)) {
        pending.set(identity, key);
      }
      return identity;
    });

    const fulfillment = new LazyFulfillment({
      field: options.field,
      keys: options.keys,
      identities,
      eagers: eager,
      preDeferred: options.preDeferred ?? null,
    });
    this.promised.push(fulfillment);
    return fulfillment.promise;
  }

  collectResults(deferred: LazyFulfillment): unknown[] {
    const identities = deferred.identities;
    const eagers = deferred.eagers;
    const results = this.resultsByIdentity;
    if (eagers) {
      const keys = deferred.keys;
      return identities.map((identity, i) =>
        identity === KEY_OMISSION ? eagers.get(keys[i]) : results.get(identity),
      );
    }
    return identities.map((identity) => results.get(identity));
  }

  execute(context: Ctx): void {
    const deferreds = this.promised;
    if (this.pendingKeysByIdentity.size > 0) {
      const pendingKeys = Array.from(this.pendingKeysByIdentity.values());

      if (this.map) {
        const pendingIdentities = Array.from(this.pendingKeysByIdentity.keys());
        this.reset();

        const results = this.performMap(pendingKeys, context);
        if (pendingKeys.length !== results.length) {
          throw new ImplementationError(
            `Wrong number of results. Expected ${pendingKeys.length}, got ${results.length}`,
          );
        }
        for (let i = 0; i < pendingIdentities.length; i++) {
          this.resultsByIdentity.set(pendingIdentities[i], results[i]);
        }
      } else {
        this.reset();
        this.perform(pendingKeys, context);
      }
    } else {
      this.reset();
    }

    for (const deferred of deferreds) {
      deferred.resolve(this.collectResults(deferred));
    }
  }

  reset(): void {
    this.pendingKeysByIdentity.clear();
    this.promised = [];
  }
}
