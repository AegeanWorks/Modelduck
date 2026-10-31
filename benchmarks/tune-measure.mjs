import { itemPassed, mcnemarExact, wilson } from "./stats.mjs";

/** Measuring candidates for a tune: a per-item cache with a run budget, and the statistics each choice is made on. */

export const round = (value, digits = 1) => Number(value.toFixed(digits));

export function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stdev(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

const settingsKey = (settings) => JSON.stringify(Object.keys(settings).sort().map((key) => [key, settings[key]]));

/** Per-item result cache with a run budget; a rung only asks for the items it has not seen. */
export class Measurements {
  constructor(evaluate, maxRuns, onAnswers = () => {}) {
    this.evaluate = evaluate;
    this.maxRuns = maxRuns;
    // Called with every newly measured answer, for the run record (ADR-050).
    this.onAnswers = onAnswers;
    this.runs = 0;
    this.slots = new Map();
    // Why measuring stopped early (the model cannot load at all), or null.
    this.stopped = null;
  }

  get exhausted() {
    return this.runs >= this.maxRuns || this.stopped !== null;
  }

  /** Stop every further measurement; later stages see the budget as spent and end. */
  stop(reason) {
    this.stopped ??= reason;
  }

  async measure(settings, itemIds, seed) {
    const slotKey = `${settingsKey(settings)}|${seed}`;
    if (!this.slots.has(slotKey)) this.slots.set(slotKey, { items: new Map(), memoryBytes: undefined });
    const slot = this.slots.get(slotKey);
    const missing = itemIds.filter((id) => !slot.items.has(id));
    if (missing.length) {
      if (this.exhausted) return null;
      const out = await this.evaluate(settings, missing, seed);
      this.runs += missing.length;
      this.onAnswers(settings, seed, out.prompts);
      for (const prompt of out.prompts) slot.items.set(prompt.id, prompt);
      slot.memoryBytes = out.memoryBytes ?? slot.memoryBytes;
    }
    return { prompts: itemIds.map((id) => slot.items.get(id)), memoryBytes: slot.memoryBytes };
  }
}

/**
 * Pass rate (seed-averaged), Wilson CI, latency, answer length and speed of
 * one settings combination on one item set. Resolves null when the run budget
 * is spent. Internal per-item maps are removed by `publicStats`.
 */
export async function score(measurements, settings, itemIds, seeds) {
  const used = settings.temperature > 0 ? seeds : seeds.slice(0, 1);
  const fractions = new Map(itemIds.map((id) => [id, 0]));
  const itemLatency = new Map();
  const itemTokens = new Map();
  const itemSpeed = new Map();
  const digests = new Map();
  const latencies = [];
  const tokens = [];
  const speeds = [];
  let memoryBytes;
  let errors = 0;
  let firstError = null;
  for (const seed of used) {
    const measured = await measurements.measure(settings, itemIds, seed);
    if (!measured) return null;
    memoryBytes = measured.memoryBytes;
    for (const prompt of measured.prompts) {
      if (prompt.error) {
        errors += 1;
        firstError ??= prompt.error;
      }
      if (itemPassed(prompt)) fractions.set(prompt.id, fractions.get(prompt.id) + 1 / used.length);
      if (Number.isFinite(prompt.ms)) {
        latencies.push(prompt.ms);
        itemLatency.set(prompt.id, (itemLatency.get(prompt.id) ?? 0) + prompt.ms / used.length);
      }
      if (Number.isFinite(prompt.outputTokens)) {
        tokens.push(prompt.outputTokens);
        itemTokens.set(prompt.id, (itemTokens.get(prompt.id) ?? 0) + prompt.outputTokens / used.length);
      }
      if (Number.isFinite(prompt.tokensPerSecond)) {
        speeds.push(prompt.tokensPerSecond);
        itemSpeed.set(prompt.id, (itemSpeed.get(prompt.id) ?? 0) + prompt.tokensPerSecond / used.length);
      }
      if (seed === used[0]) digests.set(prompt.id, prompt.digest ?? null);
    }
  }
  const passed = [...fractions.values()].reduce((sum, value) => sum + value, 0);
  return {
    rate: round((passed / itemIds.length) * 100),
    ci95: wilson(passed, itemIds.length),
    latencyMs: latencies.length ? round(median(latencies)) : null,
    latencySd: latencies.length ? round(stdev(latencies)) : null,
    outputTokens: tokens.length ? round(median(tokens)) : null,
    tokensPerSecond: speeds.length ? round(median(speeds), 2) : null,
    items: itemIds.length,
    seeds: used.length,
    memoryBytes,
    // Every answer errored: the settings did not load or run, which is not a measurement.
    failed: errors === itemIds.length * used.length,
    error: firstError,
    majority: new Map([...fractions].map(([id, fraction]) => [id, fraction >= 0.5])),
    itemLatency,
    itemTokens,
    itemSpeed,
    digests,
  };
}

export const publicStats = ({ majority: _majority, itemLatency: _latency, itemTokens: _tokens, itemSpeed: _speed, digests: _digests, ...stats }) => stats;

/** Paired comparison on the majority-vote pass of each item. */
export function paired(before, after) {
  let b = 0;
  let c = 0;
  for (const [id, passed] of before.majority) {
    if (passed && !after.majority.get(id)) b += 1;
    if (!passed && after.majority.get(id)) c += 1;
  }
  return { b, c, pValue: round(mcnemarExact(b, c), 4) };
}

/**
 * Paired comparison on the items both answered (`cost` is "itemLatency",
 * "itemTokens" or "itemSpeed", where higher is better): the mean per-item difference (after − before) is real only
 * when it exceeds both the tie band and twice its standard error.
 */
export function costDelta(before, after, speedTie, cost = "itemLatency") {
  const diffs = [];
  let baseline = 0;
  for (const [id, value] of before[cost]) {
    if (!after[cost].has(id)) continue;
    diffs.push(after[cost].get(id) - value);
    baseline += value;
  }
  if (!diffs.length) return { meanDelta: 0, se: 0, significant: false };
  const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  const se = diffs.length > 1 ? stdev(diffs) * Math.sqrt(diffs.length / (diffs.length - 1)) / Math.sqrt(diffs.length) : 0;
  const band = Math.max(speedTie * (baseline / diffs.length), 2 * se);
  return { meanDelta: round(mean), se: round(se), significant: Math.abs(mean) > band };
}

/** Items whose answer text differs from the reference run, by digest. */
export function changedAnswers(reference, stats) {
  return [...reference.digests].filter(([id, digest]) => digest === null || stats.digests.get(id) !== digest).map(([id]) => id);
}

export const matches = (settings, patch) => Object.entries(patch).every(([key, value]) => settings[key] === value);
export const pick = (settings, keys) => Object.fromEntries(keys.filter((key) => key in settings).map((key) => [key, settings[key]]));
// `extraKeys` are settings an axis may also change through `widen` (reasoning's answer length).
export const axisKeys = (axes) => [...new Set(axes.flatMap((axis) => [...axis.patches.flatMap(Object.keys), ...(axis.extraKeys ?? [])]))];

/** The axis values to measure on top of `current`; impossible combinations are listed instead of run. */
export function candidatesFor(axis, current, valid) {
  const candidates = [];
  const skipped = [];
  for (const [index, listed] of axis.patches.entries()) {
    // An axis may adjust a value to what it needs on top of `current` (ADR-046).
    const patch = axis.widen ? axis.widen(current, listed) : listed;
    const incumbent = matches(current, patch);
    if (!incumbent && !valid({ ...current, ...patch })) skipped.push(patch);
    else candidates.push({ patch, index, incumbent });
  }
  if (!candidates.some((entry) => entry.incumbent)) {
    candidates.push({ patch: pick(current, axisKeys([axis])), index: axis.patches.length, incumbent: true });
  }
  return { candidates, skipped };
}
