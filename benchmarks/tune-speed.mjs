import { candidatesFor, changedAnswers, costDelta, pick, axisKeys, publicStats, score } from "./tune-measure.mjs";

/**
 * Stage 2 (ADR-030): load settings that should only change speed — threads,
 * batch, flash attention, mmap — measured on a fixed workload with greedy
 * answers. A candidate whose answers differ from the stage's starting answers
 * did change quality after all and is excluded. Picks the fastest setting and
 * a Light one that uses at most half the logical threads.
 */

const latencyOf = (entry) => entry.stats.latencyMs ?? Infinity;

/** Fastest candidate that kept every answer; a gap inside the measurement noise keeps the incumbent. */
function chooseFastest(entries, speedTie) {
  const ok = entries.filter((entry) => !entry.stats.failed && !entry.changedItems.length);
  if (!ok.length) return entries.find((entry) => entry.incumbent);
  const fastest = [...ok].sort((left, right) => latencyOf(left) - latencyOf(right))[0];
  const tied = ok.filter((entry) => {
    if (entry === fastest) return true;
    const delta = costDelta(fastest.stats, entry.stats, speedTie);
    return !(delta.significant && delta.meanDelta > 0);
  });
  return tied.find((entry) => entry.incumbent) ?? fastest;
}

function summarise(entry) {
  return { patch: entry.patch, ...publicStats(entry.stats), changedItems: entry.changedItems };
}

/**
 * Run the speed stage from `start`. `isDone(pass, axis)` skips sweeps a
 * resumed tune already finished; `onSweep(record, current)` is called after
 * each one so progress can be saved. Resolves `{ current, fastest, light, aborted }`.
 */
export async function speedStage(context, { axes, start, items, forced, logicalCores, isDone = () => false, onSweep = () => {} }) {
  const { measurements, options } = context;
  const seeds = options.seeds.slice(0, 1);
  const reference = await score(measurements, { ...start, ...forced }, items, seeds);
  if (!reference) return { current: start, aborted: true };
  const keys = axisKeys(axes);
  let current = { ...start };
  let threadEntries = null;
  for (let pass = 1; pass <= options.passes; pass += 1) {
    let changed = false;
    for (const axis of axes) {
      if (isDone(pass, axis.name)) continue;
      if (measurements.exhausted) return { current, aborted: true };
      const { candidates, skipped } = candidatesFor(axis, current, context.valid);
      for (const entry of candidates) {
        entry.stats = await score(measurements, { ...current, ...entry.patch, ...forced }, items, seeds);
        if (!entry.stats) return { current, aborted: true };
        entry.changedItems = entry.stats.failed ? [] : changedAnswers(reference, entry.stats);
        context.onEvent({ type: "candidate", stage: "speed", task: null, axis: axis.name, rung: items.length, patch: entry.patch, rate: entry.stats.rate, latencyMs: entry.stats.latencyMs, tokensPerSecond: entry.stats.tokensPerSecond, changedItems: entry.changedItems, runs: measurements.runs });
      }
      const winner = chooseFastest(candidates, options.speedTie);
      const incumbent = candidates.find((entry) => entry.incumbent);
      if (axis.name === "threads") threadEntries = candidates;
      const record = {
        stage: "speed",
        task: null,
        pass,
        axis: axis.name,
        skipped,
        rungs: [{ size: items.length, candidates: candidates.map(summarise) }],
        previous: incumbent.patch,
        winner: winner.patch,
        changed: winner !== incumbent,
        speed: { cost: "latency", ...costDelta(incumbent.stats, winner.stats, options.speedTie) },
      };
      if (record.changed) {
        current = { ...current, ...winner.patch };
        changed = true;
      }
      context.sweeps.push(record);
      context.onEvent({ type: "sweep", stage: "speed", task: null, axis: axis.name, pass, winner: winner.patch, changed: record.changed, runs: measurements.runs });
      await onSweep(record, current);
    }
    if (!changed) break;
  }
  const fastest = pick(current, keys);
  // Light and Quiet use fewer threads than the fastest setting, chosen from the same measurements.
  const threadsFor = (cap) => {
    const entries = (threadEntries ?? []).filter((entry) => entry.patch.threads <= cap);
    const winner = entries.length ? chooseFastest(entries.map((entry) => ({ ...entry, incumbent: false })), options.speedTie) : null;
    return winner && winner.patch.threads <= cap
      ? { ...fastest, threads: winner.patch.threads }
      : { ...fastest, threads: Math.min(fastest.threads ?? cap, cap) };
  };
  const half = Math.max(1, Math.floor(logicalCores / 2));
  const quarter = Math.max(1, Math.floor(logicalCores / 4));
  return { current, fastest, light: threadsFor(half), quiet: threadsFor(quarter), aborted: false };
}
