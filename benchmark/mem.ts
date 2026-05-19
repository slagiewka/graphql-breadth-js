// Memory profiling harness. Requires `--expose-gc` (the mem:* package scripts
// pass it via NODE_OPTIONS).
//
// What we measure:
//
//   heap/iter     net heap delta across the run divided by iterations. Subject
//                 to deflation when V8 triggers its own GC mid-run, but useful
//                 for workloads that fit comfortably in young-gen.
//
//   gcTime/iter   wall-clock time V8 spent in GC during the run, divided by
//                 iterations. Highly reliable proxy for allocation pressure —
//                 more bytes allocated means more GC work.
//
//   gcCount       total number of GC events V8 ran during the loop.
//
//   retained      heap that survives a forced full GC at the end (per iter).
//                 Should be near zero; non-zero values point at leaks.

import { PerformanceObserver } from "node:perf_hooks";

const g = globalThis as { gc?: () => void };

export interface MemResult {
  name: string;
  iterations: number;
  heapPerIter: number;
  retainedPerIter: number;
  gcMsPerIter: number;
  gcCount: number;
}

interface MemOptions {
  warmup?: number;
}

interface GcEvent {
  duration: number;
}

function attachGcObserver(): { events: GcEvent[]; obs: PerformanceObserver } {
  const events: GcEvent[] = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) events.push({ duration: e.duration });
  });
  obs.observe({ entryTypes: ["gc"] });
  return { events, obs };
}

// PerformanceObserver dispatches GC entries on the macrotask boundary, and on
// Node 22 it takes two ticks for events queued during a sync loop to actually
// reach the callback. Yield generously before reading the events array.
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

export async function memProfile(
  name: string,
  fn: () => unknown,
  iterations: number,
  options: MemOptions = {},
): Promise<MemResult> {
  ensureGc();
  const warmup = options.warmup ?? 200;
  for (let i = 0; i < warmup; i++) fn();
  forceGc();
  await flush();

  const { events, obs } = attachGcObserver();
  const before = process.memoryUsage();
  for (let i = 0; i < iterations; i++) fn();
  const afterNoGc = process.memoryUsage();
  await flush();
  obs.disconnect();

  forceGc();
  const afterGc = process.memoryUsage();

  const result = summarize(
    name,
    iterations,
    before.heapUsed,
    afterNoGc.heapUsed,
    afterGc.heapUsed,
    events,
  );
  printResult(result);
  return result;
}

export async function memProfileAsync(
  name: string,
  fn: () => Promise<unknown>,
  iterations: number,
  options: MemOptions = {},
): Promise<MemResult> {
  ensureGc();
  const warmup = options.warmup ?? 200;
  for (let i = 0; i < warmup; i++) await fn();
  forceGc();
  await flush();

  const { events, obs } = attachGcObserver();
  const before = process.memoryUsage();
  for (let i = 0; i < iterations; i++) await fn();
  const afterNoGc = process.memoryUsage();
  await flush();
  obs.disconnect();

  forceGc();
  const afterGc = process.memoryUsage();

  const result = summarize(
    name,
    iterations,
    before.heapUsed,
    afterNoGc.heapUsed,
    afterGc.heapUsed,
    events,
  );
  printResult(result);
  return result;
}

function summarize(
  name: string,
  iterations: number,
  beforeHeap: number,
  afterNoGcHeap: number,
  afterGcHeap: number,
  events: GcEvent[],
): MemResult {
  const gcMs = events.reduce((sum, e) => sum + e.duration, 0);
  return {
    name,
    iterations,
    heapPerIter: (afterNoGcHeap - beforeHeap) / iterations,
    retainedPerIter: (afterGcHeap - beforeHeap) / iterations,
    gcMsPerIter: gcMs / iterations,
    gcCount: events.length,
  };
}

function printResult(r: MemResult): void {
  console.log(
    `  ${r.name}: ${formatBytes(r.heapPerIter)}/iter heap, ` +
      `${(r.gcMsPerIter * 1000).toFixed(1)}µs/iter gc (${r.gcCount} events), ` +
      `${formatBytes(r.retainedPerIter)}/iter retained`,
  );
}

export function compareMemory(results: MemResult[]): void {
  if (results.length < 2) return;
  const sorted = [...results].sort((a, b) => a.gcMsPerIter - b.gcMsPerIter);
  const leanest = sorted[0]!;
  console.log("\nGC pressure (lower is better):");
  for (const r of sorted) {
    const us = (r.gcMsPerIter * 1000).toFixed(1);
    if (r === leanest) {
      console.log(`  ${r.name}: ${us}µs/iter (leanest)`);
    } else if (leanest.gcMsPerIter === 0) {
      console.log(`  ${r.name}: ${us}µs/iter (no baseline)`);
    } else {
      const ratio = r.gcMsPerIter / leanest.gcMsPerIter;
      console.log(`  ${r.name}: ${us}µs/iter - ${ratio.toFixed(2)}x more`);
    }
  }
  console.log("");
}

function ensureGc(): void {
  if (typeof g.gc !== "function") {
    console.error(
      "memory profiling requires --expose-gc. Run via `pnpm run mem:*` " +
      "which sets NODE_OPTIONS='--expose-gc', or invoke node with --expose-gc directly.",
    );
    process.exit(1);
  }
}

function forceGc(): void {
  g.gc!();
  g.gc!();
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(2)} KB`;
  return `${sign}${abs.toFixed(0)} B`;
}
