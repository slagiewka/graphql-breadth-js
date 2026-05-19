type State = "pending" | "fulfilled" | "rejected";

type OnFulfilled<T = unknown, R = unknown> = (value: T) => R | ExecutionPromise<R>;
type OnRejected<R = unknown> = (reason: unknown) => R | ExecutionPromise<R>;

// Stable shape so V8 establishes one hidden class for every observer slot.
interface Observer {
  promise: ExecutionPromise<unknown>;
  onFulfilled: OnFulfilled | null;
  onRejected: OnRejected | null;
}

const RAISE_REASON: OnRejected<never> = (reason) => {
  throw reason;
};
const IDENTITY: OnFulfilled<unknown, unknown> = (v) => v;

/**
 * A synchronous coordination primitive that happens to share Promise's interface.
 * NOT a Promise polyfill. Diverges from native Promise in three deliberate ways:
 *
 *   - `.then()` on an already-settled promise dispatches synchronously — no
 *     microtask hop. The executor can chain a callback and inspect the result
 *     on the next line, without yielding control.
 *   - State is inspectable synchronously via `resolved()`, `rejected()`,
 *     `value()`, and `reason()`. Native Promise exposes state only through
 *     `.then()`, which couples observation to async scheduling.
 *   - A `registry` array tracks pending promises so the executor can
 *     enumerate and drain them at a given level. Used by `LazyLoader` to pool
 *     I/O across a selection set — one promise per selection, not per field
 *     instance.
 *
 * Net effect: the lazy queue drains inside a single call stack — no scheduler
 * involvement, no per-leaf Promise allocation. That is what produces the
 * lazy-field GC and speed wins over graphql-js + DataLoader.
 */
export class ExecutionPromise<T = unknown> {
  private state: State = "pending";
  private _value: T | undefined;
  private _reason: unknown;
  private observers: Observer[] | null = null;
  registry: ExecutionPromise<unknown>[] | null = null;

  constructor(
    arg?:
      | {
          registry?: ExecutionPromise<unknown>[] | null;
          executor?: (
            resolve: (value: T | ExecutionPromise<T>) => void,
            reject: (reason: unknown) => void,
          ) => void;
        }
      | ((
          resolve: (value: T | ExecutionPromise<T>) => void,
          reject: (reason: unknown) => void,
        ) => void),
  ) {
    let executor:
      | ((
          resolve: (value: T | ExecutionPromise<T>) => void,
          reject: (reason: unknown) => void,
        ) => void)
      | undefined;
    let registry: ExecutionPromise<unknown>[] | null | undefined;

    if (typeof arg === "function") {
      executor = arg;
    } else if (arg) {
      executor = arg.executor;
      registry = arg.registry;
    }

    if (registry) this.withRegistry(registry);

    if (executor) {
      try {
        executor(
          (v) => this.resolve(v),
          (r) => this.reject(r),
        );
      } catch (initError) {
        this.reject(initError);
      }
    }
  }

  static all<T>(promises: ExecutionPromise<T>[]): ExecutionPromise<T[]> {
    if (promises.length === 0) {
      throw new Error("promises cannot be empty");
    }
    return new ExecutionPromise<T[]>((resolve, reject) => {
      const results: T[] = new Array(promises.length);
      let completed = 0;
      const total = promises.length;
      promises.forEach((p, i) => {
        p.then(
          (value) => {
            results[i] = value;
            completed += 1;
            if (completed === total) resolve(results);
          },
          reject,
        );
      });
    });
  }

  withRegistry(registry: ExecutionPromise<unknown>[]): this {
    this.registry = registry;
    if (!registry.includes(this as unknown as ExecutionPromise<unknown>)) {
      registry.push(this as unknown as ExecutionPromise<unknown>);
    }
    return this;
  }

  then<R = T>(
    onFulfilled?: OnFulfilled<T, R> | null,
    onRejected?: OnRejected<R> | null,
  ): ExecutionPromise<R> {
    if (!onFulfilled && !onRejected) {
      throw new Error("Either on_fulfilled or block is required");
    }
    const next = new ExecutionPromise<R>({ registry: this.registry });
    const handler = onFulfilled ?? null;
    const reject = onRejected ?? (RAISE_REASON as OnRejected<R>);

    const nextErased = next as unknown as ExecutionPromise<unknown>;
    switch (this.state) {
      case "fulfilled":
        nextErased.dispatchFulfilled(this._value, handler as OnFulfilled | null);
        break;
      case "rejected":
        nextErased.dispatchRejected(this._reason, reject as OnRejected);
        break;
      default:
        this.subscribe(
          nextErased,
          handler as OnFulfilled | null,
          reject as OnRejected,
        );
    }
    return next;
  }

  catch<R = T>(onRejected: OnRejected<R>): ExecutionPromise<R> {
    return this.then(IDENTITY as OnFulfilled<T, R>, onRejected);
  }

  resolved(): boolean {
    return this.state === "fulfilled";
  }

  rejected(): boolean {
    return this.state === "rejected";
  }

  pending(): boolean {
    return this.state === "pending";
  }

  value(): T | undefined {
    return this.state === "fulfilled" ? this._value : undefined;
  }

  reason(): unknown {
    return this.state === "rejected" ? this._reason : undefined;
  }

  // ---- internals (protected so subclasses / sibling promises can chain) ----

  /** @internal */
  dispatchFulfilled(value: T, handler: OnFulfilled | null): void {
    if (handler) {
      this.settleFromHandler(value, handler);
    } else {
      this.resolve(value);
    }
  }

  /** @internal */
  dispatchRejected(reason: unknown, handler: OnRejected | null): void {
    if (handler) {
      this.settleFromHandler(reason, handler);
    } else {
      this.reject(reason);
    }
  }

  /** @internal */
  subscribe(
    promise: ExecutionPromise<unknown>,
    onFulfilled: OnFulfilled | null,
    onRejected: OnRejected | null,
  ): void {
    const entry: Observer = { promise, onFulfilled, onRejected };
    if (this.observers) {
      this.observers.push(entry);
    } else {
      this.observers = [entry];
    }
  }

  private resolve(result: T | ExecutionPromise<T>): void {
    if (this.state !== "pending") return;

    if (result instanceof ExecutionPromise) {
      if (result === (this as unknown as ExecutionPromise<T>)) {
        this.reject(new Error("A promise cannot resolve to itself"));
        return;
      }
      if (result.resolved()) {
        this.resolve(result.value() as T);
      } else if (result.rejected()) {
        this.reject(result.reason());
      } else {
        result.subscribe(this as unknown as ExecutionPromise<unknown>, null, null);
      }
    } else {
      this.state = "fulfilled";
      this._value = result;
      this.notifyFulfilled();
    }
  }

  private reject(reason: unknown): void {
    if (this.state !== "pending") return;
    this.state = "rejected";
    this._reason = reason;
    this.notifyRejected();
  }

  private settleFromHandler(input: unknown, handler: Function): void {
    try {
      const out = (handler as (x: unknown) => unknown)(input);
      this.resolve(out as T | ExecutionPromise<T>);
    } catch (err) {
      this.reject(err);
    }
  }

  private notifyFulfilled(): void {
    if (!this.observers) return;
    const observers = this.observers;
    this.observers = null;
    for (let i = 0; i < observers.length; i++) {
      const entry = observers[i]!;
      entry.promise.dispatchFulfilled(this._value, entry.onFulfilled);
    }
  }

  private notifyRejected(): void {
    if (!this.observers) return;
    const observers = this.observers;
    this.observers = null;
    for (let i = 0; i < observers.length; i++) {
      const entry = observers[i]!;
      entry.promise.dispatchRejected(this._reason, entry.onRejected);
    }
  }
}

export class Deferred<T = unknown> {
  promise: ExecutionPromise<T>;
  resolver: (value: T | ExecutionPromise<T>) => void = () => undefined;

  constructor(options: { registry?: ExecutionPromise<unknown>[] | null } = {}) {
    this.promise = new ExecutionPromise<T>({
      registry: options.registry ?? null,
      executor: (resolve) => {
        this.resolver = resolve;
      },
    });
  }
}
