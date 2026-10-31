import { costDelta, publicStats, score } from "./tune-measure.mjs";

/**
 * Stage 0 (ADR-031): where does this model run fastest? Measures the fixed
 * speed workload on the CPU and on each GPU backend with every layer
 * offloaded (half the layers only if that fails to load). A GPU wins only
 * when it is measurably faster and answers at least as many items as the CPU,
 * since its different rounding can change answers.
 */

const CPU = Object.freeze({ gpuBackend: "cpu", gpuLayers: 0 });

// Answers differ slightly between devices, so compare throughput, not time per answer.
const speedOf = (entry) => entry.stats.tokensPerSecond ?? 0;
const passedOf = (entry) => Math.round((entry.stats.rate / 100) * entry.stats.items);

function candidatePatches(backends, layers) {
  const gpus = backends.filter((backend) => backend !== "cpu");
  return {
    first: [CPU, ...gpus.map((gpuBackend) => ({ gpuBackend, gpuLayers: "max" }))],
    fallback: (gpuBackend) => (layers > 1 ? { gpuBackend, gpuLayers: Math.ceil(layers / 2) } : null),
  };
}

function summarise(entry, verdict) {
  return { patch: entry.patch, ...publicStats(entry.stats), passed: passedOf(entry), verdict };
}

/**
 * Probe the devices from `start`. Resolves `{ settings, probe, reason, aborted }`;
 * `settings` is `{ gpuBackend, gpuLayers }` for the chosen device.
 */
export async function deviceStage(context, { backends, layers = 0, start, items, forced }) {
  const { measurements, options } = context;
  const seeds = options.seeds.slice(0, 1);
  const { first, fallback } = candidatePatches(backends, layers);
  const entries = [];
  const measure = async (patch) => {
    const stats = await score(measurements, { ...start, ...patch, ...forced }, items, seeds);
    if (!stats) return null;
    const entry = { patch, stats };
    entries.push(entry);
    context.onEvent({ type: "candidate", stage: "device", task: null, axis: "device", rung: items.length, patch, rate: stats.rate, latencyMs: stats.latencyMs, tokensPerSecond: stats.tokensPerSecond, failed: stats.failed, runs: measurements.runs });
    return entry;
  };
  for (const patch of first) {
    const entry = await measure(patch);
    if (!entry) return { aborted: true };
    const half = entry.stats.failed && patch.gpuBackend !== "cpu" ? fallback(patch.gpuBackend) : null;
    if (half && !(await measure(half))) return { aborted: true };
  }

  const cpu = entries[0];
  const verdicts = new Map();
  for (const entry of entries.slice(1)) {
    if (entry.stats.failed) verdicts.set(entry, `did not run: ${entry.stats.error}`);
    else if (!cpu.stats.failed && passedOf(entry) < passedOf(cpu)) verdicts.set(entry, `answered ${passedOf(entry)} of ${entry.stats.items} correctly vs ${passedOf(cpu)} on the CPU`);
    else {
      const delta = cpu.stats.failed ? { significant: true, meanDelta: 1 } : costDelta(cpu.stats, entry.stats, options.speedTie, "itemSpeed");
      verdicts.set(entry, delta.significant && delta.meanDelta > 0 ? "faster than the CPU" : "not measurably faster than the CPU");
    }
  }
  const winners = entries.slice(1).filter((entry) => verdicts.get(entry) === "faster than the CPU");
  const chosen = winners.sort((left, right) => speedOf(right) - speedOf(left))[0] ?? cpu;
  verdicts.set(cpu, cpu.stats.failed ? `did not run: ${cpu.stats.error}` : chosen === cpu ? "chosen" : "slower than the chosen GPU");
  if (chosen !== cpu) verdicts.set(chosen, "chosen");
  const tokS = (entry) => (entry.stats.tokensPerSecond ? `${entry.stats.tokensPerSecond} tok/s` : `${entry.stats.latencyMs} ms/answer`);
  const reason = chosen === cpu
    ? `CPU kept (${tokS(cpu)}): no GPU option was both faster and as accurate.`
    : `${chosen.patch.gpuBackend} with ${chosen.patch.gpuLayers} layers: ${tokS(chosen)} vs ${cpu.stats.failed ? `the CPU could not run it (${cpu.stats.error})` : `${tokS(cpu)} on the CPU`}, ${passedOf(chosen)}/${chosen.stats.items} correct.`;
  return {
    settings: { ...chosen.patch },
    probe: entries.map((entry) => summarise(entry, verdicts.get(entry))),
    reason,
    aborted: false,
  };
}
