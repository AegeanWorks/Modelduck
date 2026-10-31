/**
 * The tune gate's baseline (G-001, G-003): each core model's tuned settings
 * and the per-task rates they reached. The gate re-measures those settings
 * after a change and fails on a quality drop beyond one item.
 */
export const BASELINE_SCHEMA = 1;
export const IDENTITY_KEYS = Object.freeze(["suiteVersion", "taskHash", "nodeLlamaCpp"]);

const round = (value) => Number(value.toFixed(1));

/** What the gate keeps of one profile: settings and rates, without the sweep log. */
export function baselineEntry(profile) {
  return {
    load: { ...profile.load.settings },
    tasks: Object.fromEntries(Object.entries(profile.tasks).map(([task, preset]) => [
      task,
      { settings: { ...preset.settings }, rate: preset.stats?.rate ?? null, items: preset.stats?.items ?? null, latencyMs: preset.stats?.latencyMs ?? null },
    ])),
  };
}

/** Keys that make a baseline incomparable with the current run; empty when it can be used. */
export function comparability(baseline, identity) {
  if (baseline?.schema !== BASELINE_SCHEMA) return ["schema"];
  return IDENTITY_KEYS.filter((key) => baseline[key] !== identity[key]);
}

/**
 * Compare re-measured task rates with the baseline. `current` maps model →
 * task → { rate, items, latencyMs }. A drop larger than one item is a
 * regression; latency is reported but never gates, since it depends on the machine.
 */
export function compareToBaseline(baseline, current, { toleranceItems = 1 } = {}) {
  const rows = [];
  for (const [model, entry] of Object.entries(baseline.models ?? {})) {
    for (const [task, saved] of Object.entries(entry.tasks)) {
      const now = current[model]?.[task];
      if (!now) {
        rows.push({ model, task, missing: true, regression: true });
        continue;
      }
      const tolerance = (toleranceItems / (now.items || saved.items || 1)) * 100;
      const delta = round(now.rate - saved.rate);
      rows.push({
        model,
        task,
        baselineRate: saved.rate,
        rate: now.rate,
        delta,
        tolerance: round(tolerance),
        regression: delta < -tolerance,
        latencyDeltaMs: saved.latencyMs !== null && now.latencyMs !== null ? round(now.latencyMs - saved.latencyMs) : null,
      });
    }
  }
  return { passed: rows.every((row) => !row.regression), rows };
}
