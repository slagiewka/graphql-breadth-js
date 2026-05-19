// Tiny benchmark harness: warmup phase, fixed measurement window,
// iterations-per-second output with a comparison table.

const DEFAULT_WARMUP_SEC = 1;
const DEFAULT_RUN_SEC = 3;

export interface BenchResult {
  name: string;
  ips: number;
  iterations: number;
  elapsedSec: number;
}

interface BenchOptions {
  warmupSec?: number;
  runSec?: number;
}

export function bench(
  name: string,
  fn: () => unknown,
  options: BenchOptions = {},
): BenchResult {
  const warmupSec = options.warmupSec ?? DEFAULT_WARMUP_SEC;
  const runSec = options.runSec ?? DEFAULT_RUN_SEC;

  const warmupEnd = performance.now() + warmupSec * 1000;
  while (performance.now() < warmupEnd) fn();

  triggerGC();

  let iterations = 0;
  const start = performance.now();
  const end = start + runSec * 1000;
  while (performance.now() < end) {
    fn();
    iterations++;
  }
  const elapsedSec = (performance.now() - start) / 1000;
  const ips = iterations / elapsedSec;

  console.log(`  ${name}: ${formatIps(ips)} i/s`);
  return { name, ips, iterations, elapsedSec };
}

export async function benchAsync(
  name: string,
  fn: () => Promise<unknown>,
  options: BenchOptions = {},
): Promise<BenchResult> {
  const warmupSec = options.warmupSec ?? DEFAULT_WARMUP_SEC;
  const runSec = options.runSec ?? DEFAULT_RUN_SEC;

  const warmupEnd = performance.now() + warmupSec * 1000;
  while (performance.now() < warmupEnd) await fn();

  triggerGC();

  let iterations = 0;
  const start = performance.now();
  const end = start + runSec * 1000;
  while (performance.now() < end) {
    await fn();
    iterations++;
  }
  const elapsedSec = (performance.now() - start) / 1000;
  const ips = iterations / elapsedSec;

  console.log(`  ${name}: ${formatIps(ips)} i/s`);
  return { name, ips, iterations, elapsedSec };
}

export function compare(results: BenchResult[]): void {
  if (results.length < 2) return;
  const sorted = [...results].sort((a, b) => b.ips - a.ips);
  const fastest = sorted[0]!;
  console.log("\nComparison:");
  for (const r of sorted) {
    if (r === fastest) {
      console.log(`  ${r.name}: ${formatIps(r.ips)} i/s (fastest)`);
    } else {
      const ratio = fastest.ips / r.ips;
      console.log(`  ${r.name}: ${formatIps(r.ips)} i/s - ${ratio.toFixed(2)}x slower`);
    }
  }
  console.log("");
}

function formatIps(ips: number): string {
  if (ips >= 1_000_000) return `${(ips / 1_000_000).toFixed(2)}M`;
  if (ips >= 1_000) return `${(ips / 1_000).toFixed(2)}k`;
  if (ips >= 100) return ips.toFixed(1);
  return ips.toFixed(2);
}

function triggerGC(): void {
  const g = globalThis as { gc?: () => void };
  if (typeof g.gc === "function") g.gc();
}

export function envList(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function envInts(name: string, fallback: string): number[] {
  return envList(name, fallback).map((s) => {
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) throw new Error(`Invalid integer for ${name}: ${s}`);
    return n;
  });
}
