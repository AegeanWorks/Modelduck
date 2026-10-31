import {
  promptAxes as defaultPromptAxes,
  qualityAxes as defaultQualityAxes,
  samplingAxes as defaultSamplingAxes,
  speedAxes as defaultSpeedAxes,
  isValidCombination,
} from "./tune-grid.mjs";
import { Measurements, axisKeys, candidatesFor, costDelta, lookPoints, paired, pick, publicStats, round, score, scoreSequential, solvedCount } from "./tune-measure.mjs";
import { deviceStage } from "./tune-device.mjs";
import { holm, mcnemarExact } from "./stats.mjs";
import { speedStage } from "./tune-speed.mjs";

/**
 * Settings search for one model (ADR-027, ADR-030, ADR-031): a device probe,
 * then quality load settings → speed load settings → sampling per task → prompt
 * per task. Each axis is a coordinate-descent step on top of the current best
 * combination, pruned by successive halving over nested rungs. Progress is
 * reported after every axis, so a tune can stop anywhere, be applied as far
 * as it got, and resume later.
 */
export const DEFAULT_TUNE_OPTIONS = Object.freeze({
  seeds: Object.freeze([42, 7, 1234]),
  passes: 2,
  maxRuns: 20000,
  toleranceItems: 1,
  keepFraction: 0.5,
  speedTie: 0.03,
  // A challenger that is better only on quality must beat the current setting in a paired
  // test at this level, Holm-adjusted across the surviving challengers, or the current setting stays (ADR-042, ADR-063).
  changeAlpha: 0.2,
  // The alpha an early stop may spend over one axis's looks; defaults to changeAlpha.
  stopAlpha: null,
  // A rung is checked this many times for an early stop, in equal blocks of items (ADR-063).
  looks: 4,
  // A fully scored axis (system prompts) first answers this share of its items.
  screenFraction: 0.25,
});

// A screen of fewer items cannot tell a significant gap from noise, so it is skipped.
const MIN_SCREEN_ITEMS = 8;

export const STAGES = Object.freeze(["device", "quality", "speed", "sampling", "prompt"]);

// Until sampling is tuned, answer greedily within each item's own token budget.
const GREEDY = Object.freeze({ temperature: 0, maxTokens: null });
// Timing stages answer one item at a time even when the others run in parallel.
const TIMED = Object.freeze({ ...GREEDY, parallelism: 1, timed: true });
const COST = Object.freeze({ latency: { item: "itemLatency", summary: "latencyMs" }, tokens: { item: "itemTokens", summary: "outputTokens" } });

const emptyStage = () => ({ status: "pending", settings: {}, done: [], stats: null });

/** A fresh progress state: every stage pending, nothing tuned. */
export function emptyProgress() {
  return { device: { ...emptyStage(), probe: null, reason: null }, quality: emptyStage(), speed: { ...emptyStage(), fastest: null, light: null, quiet: null }, sampling: {}, prompt: {}, holdout: {}, sweeps: [], runs: 0 };
}

const costOf = (entry, cost) => entry.stats[COST[cost].summary] ?? Infinity;
const byQuality = (cost) => (left, right) =>
  Number(left.stats.failed) - Number(right.stats.failed) || right.stats.rate - left.stats.rate || costOf(left, cost) - costOf(right, cost) || left.index - right.index;

/**
 * Best rate first; among those within tolerance, the cheapest (latency or
 * answer tokens). A candidate ties with the cheapest unless it is measurably
 * dearer. The tolerance buys speed only: ties go to the higher rate, then
 * less memory, then the incumbent. Candidates whose answers all failed never win.
 */
function choose(candidates, floor, speedTie, cost) {
  const working = candidates.filter((entry) => !entry.stats.failed);
  const scored = working.length ? working : candidates;
  const top = Math.max(...scored.map((entry) => entry.stats.rate));
  let eligible = scored.filter((entry) => entry.stats.rate >= Math.min(floor, top));
  if (!eligible.length) eligible = scored.filter((entry) => entry.stats.rate === top);
  const cheapest = [...eligible].sort((left, right) => costOf(left, cost) - costOf(right, cost))[0];
  const tied = eligible.filter((entry) => {
    const delta = costDelta(cheapest.stats, entry.stats, speedTie, COST[cost].item);
    return entry === cheapest || !(delta.significant && delta.meanDelta > 0);
  });
  return tied.sort((left, right) =>
    right.stats.rate - left.stats.rate ||
    (left.stats.memoryBytes ?? Infinity) - (right.stats.memoryBytes ?? Infinity) ||
    Number(right.incumbent) - Number(left.incumbent) ||
    left.index - right.index)[0];
}

// A coding view needs this many items for its paired test to mean anything.
const MIN_GROUP_ITEMS = 8;

/** Paired b/c between two runs on one view's items. */
function groupEvidence(before, after, ids) {
  let b = 0;
  let c = 0;
  for (const id of ids) {
    const was = before.majority.get(id);
    const now = after.majority.get(id);
    if (was === undefined || now === undefined) continue;
    if (was && !now) b += 1;
    if (!was && now) c += 1;
  }
  return { b, c, pValue: round(mcnemarExact(b, c), 4) };
}

const groupRate = (stats, ids) => (ids.length ? round((ids.filter((id) => stats.majority.get(id)).length / ids.length) * 100) : null);

/** Per-view rate and paired evidence for a candidate against the current setting. */
function groupStats(before, after, groups) {
  return Object.fromEntries(Object.entries(groups).map(([group, ids]) => {
    const evidence = groupEvidence(before, after, ids);
    return [group, { items: ids.length, rate: groupRate(after, ids), before: groupRate(before, ids), ...evidence, worse: evidence.b > evidence.c && evidence.pValue < 0.05 }];
  }));
}

/**
 * A coding preset must not buy an overall gain by sacrificing a view (ADR-070). When the
 * chosen candidate is clearly worse than the current setting on one view, a candidate that
 * is not worse on any view takes its place; with none, the current setting stays.
 */
function balancedChoice({ survivors, incumbent, chosen, itemIds, context, floor, cost }) {
  if (!context.groupOf) return null;
  const groups = {};
  for (const id of itemIds) {
    const group = context.groupOf(id);
    if (group) (groups[group] ??= []).push(id);
  }
  const usable = Object.fromEntries(Object.entries(groups).filter(([, ids]) => ids.length >= MIN_GROUP_ITEMS));
  if (Object.keys(usable).length < 2) return null;
  const chosenGroups = groupStats(incumbent.stats, chosen.stats, usable);
  const worse = Object.entries(chosenGroups).filter(([, entry]) => entry.worse).map(([group]) => group);
  if (!worse.length) return { chosen, groups: chosenGroups, guard: null };
  const safe = survivors.filter((entry) => entry === incumbent || !Object.values(groupStats(incumbent.stats, entry.stats, usable)).some((group) => group.worse));
  const eligible = safe.filter((entry) => entry.stats.rate >= floor);
  const replacement = eligible.length ? choose(eligible, floor, context.options.speedTie, cost) : incumbent;
  return {
    chosen: replacement,
    groups: groupStats(incumbent.stats, replacement.stats, usable),
    guard: `Kept ${JSON.stringify(Object.values(replacement.patch)[0])}: the higher-scoring ${JSON.stringify(Object.values(chosen.patch)[0])} was clearly worse on ${worse.join(", ")}.`,
  };
}

/** One axis: successive halving over the rungs (or one full rung), stopping a value that falls significantly behind, then the selection rule on the last rung. */
async function sweep(context, { stage, task, axis, current, rungs, forced, cost }) {
  const { measurements, options } = context;
  const { candidates, skipped } = candidatesFor(axis, current, context.valid);
  let levels = axis.full ? rungs.slice(-1) : rungs;
  const screen = axis.full ? Math.ceil(levels[0].length * options.screenFraction) : 0;
  if (screen >= MIN_SCREEN_ITEMS && screen < levels[0].length) levels = [levels[0].slice(0, screen), levels[0]];
  let survivors = candidates;
  const record = { stage, task, axis: axis.name, skipped, full: Boolean(axis.full), rungs: [] };
  const looks = levels.map((itemIds) => lookPoints(itemIds.length, options.looks));
  // Every look spends an equal share of one error budget over the axis (ADR-063). A non-finite
  // stop alpha turns the screen off, which the mechanics tests need.
  const stopAlpha = options.stopAlpha ?? options.changeAlpha;
  const lookBudget = Math.max(1, looks.reduce((sum, points) => sum + points.length, 0));
  const alphaPerLook = Number.isFinite(stopAlpha) && stopAlpha > 0 ? stopAlpha / lookBudget : null;
  for (const [level, itemIds] of levels.entries()) {
    // The current setting answers first, so every challenger is compared with a complete reference.
    const ordered = [...survivors].sort((left, right) => Number(right.incumbent) - Number(left.incumbent));
    let reference = ordered.find((entry) => entry.incumbent) ?? null;
    for (const entry of ordered) {
      const settings = { ...current, ...entry.patch, ...forced };
      if (entry.incumbent) entry.stats = await score(measurements, settings, itemIds, options.seeds);
      else {
        // A challenger stops at the first look where it is significantly worse than the best completed value (ADR-063).
        entry.stats = await scoreSequential(measurements, settings, itemIds, options.seeds, {
          lookAt: looks[level],
          shouldStop: (stats) => {
            if (alphaPerLook === null || !reference?.stats) return false;
            const evidence = paired(reference.stats, stats);
            if (!(evidence.b > evidence.c && evidence.pValue / 2 <= alphaPerLook)) return false;
            entry.stopped = { p: evidence.pValue, behind: evidence.b - evidence.c };
            return true;
          },
        });
      }
      if (!entry.stats) return { ...record, aborted: true, winner: null };
      const { rate, latencyMs, outputTokens, tokensPerSecond } = entry.stats;
      context.onEvent({ type: "candidate", stage, task, axis: axis.name, rung: itemIds.length, patch: entry.patch, rate, latencyMs, outputTokens, tokensPerSecond, runs: measurements.runs });
      // Only a fully answered value can lead; a stopped prefix is compared with, never used as the bar.
      if (!entry.stats.partial && (!reference?.stats || entry.stats.rate > reference.stats.rate)) reference = entry;
    }
    record.rungs.push({ size: itemIds.length, candidates: ordered.map((entry) => ({ patch: entry.patch, ...publicStats(entry.stats), partial: Boolean(entry.stats.partial) })) });
    // Nothing loads, the current settings included: the machine changed (a driver, memory), not the setting.
    // Choosing among failures would store them as results, so the tune stops here instead.
    if (ordered.every((entry) => entry.stats.failed)) {
      measurements.stop(`The model could not load with any ${axis.name} tried, the current one included: ${ordered[0].stats.error ?? "every answer failed"}`);
      return { ...record, aborted: true, winner: null };
    }
    // A stopped value did not finish its rung, so it is out of this sweep (ADR-063).
    const dropped = ordered.filter((entry) => entry.stats.partial);
    if (dropped.length) {
      record.dropped = [...(record.dropped ?? []), ...dropped.map((entry) => ({
        patch: entry.patch,
        solved: solvedCount(entry.stats),
        of: entry.stats.items,
        behind: entry.stopped?.behind ?? 0,
        p: entry.stopped?.p ?? null,
      }))];
      survivors = ordered.filter((entry) => !entry.stats.partial);
    }
    if (level === levels.length - 1) break;
    // Nothing left to compare with: the sweep ends here instead of answering later rungs.
    if (survivors.length === 1 && survivors[0].incumbent) {
      record.endedEarly = "only the current setting is left";
      break;
    }
    if (axis.full) continue;
    const keep = Math.max(2, Math.ceil(survivors.length * options.keepFraction));
    const ranked = [...survivors].sort(byQuality(cost));
    survivors = ranked.filter((entry, index) => index < keep || entry.incumbent).sort((left, right) => left.index - right.index);
  }
  const top = Math.max(...survivors.filter((entry) => !entry.stats.failed).map((entry) => entry.stats.rate), 0);
  const tolerance = (options.toleranceItems / levels.at(-1).length) * 100;
  const floor = Math.max(top, context.stageBest) - tolerance;
  const rawChosen = choose(survivors, floor, options.speedTie, cost);
  const incumbent = survivors.find((entry) => entry.incumbent);
  // The code task keeps every coding view in mind, not only the overall rate (ADR-070).
  const balanced = task && incumbent && context.groupOf && rawChosen.stats.items >= levels.at(-1).length
    ? balancedChoice({ survivors, incumbent, chosen: rawChosen, itemIds: levels.at(-1), context, floor, cost })
    : null;
  const chosen = balanced?.chosen ?? rawChosen;
  // The best of many noisy rates is optimistic, so a quality-only gain must be real to move the setting.
  // Holm covers the challengers that survived the screens, not every value first tried (ADR-042, ADR-063).
  const challengers = survivors.filter((entry) => entry !== incumbent);
  const adjusted = holm(challengers.map((entry) => paired(incumbent.stats, entry.stats).pValue));
  const chosenP = chosen === incumbent ? 1 : adjusted[challengers.indexOf(chosen)] ?? 1;
  const evidence = paired(incumbent.stats, chosen.stats);
  const unproven = chosen !== incumbent && !incumbent.stats.failed && chosen.stats.rate > incumbent.stats.rate &&
    !(evidence.c > evidence.b && chosenP <= options.changeAlpha);
  const winner = unproven ? incumbent : chosen;
  // The guard only explains the sweep when the value it chose is the one that stands.
  const guard = balanced?.guard && winner === balanced.chosen ? balanced.guard : undefined;
  const groups = balanced?.groups && winner === balanced.chosen ? balanced.groups : undefined;
  const kept = unproven
    ? `Kept ${JSON.stringify(Object.values(incumbent.patch)[0])}: the best challenger, ${JSON.stringify(Object.values(chosen.patch)[0])}, ` +
      `scored ${chosen.stats.rate}% against ${incumbent.stats.rate}% (paired p=${evidence.pValue}, Holm p=${round(chosenP, 4)}), short of the p ≤ ${options.changeAlpha} a change needs.`
    : undefined;
  // Only a score over the axis's whole rung compares with the next axis (ADR-062).
  if (winner.stats.items >= levels.at(-1).length) context.stageBest = Math.max(context.stageBest, winner.stats.rate);
  return {
    ...record,
    ...(kept && { kept }),
    ...(groups && { groups }),
    ...(guard && { groupGuard: guard }),
    ...(chosen !== incumbent && { pAdjusted: round(chosenP, 4) }),
    previous: incumbent.patch,
    winner: winner.patch,
    changed: winner !== incumbent,
    ...paired(incumbent.stats, winner.stats),
    speed: { cost, ...costDelta(incumbent.stats, winner.stats, options.speedTie, COST[cost].item) },
  };
}

/**
 * Coordinate descent over the axes, repeated while a pass still changes
 * something. `isDone(pass, axis)` skips sweeps a resumed tune finished;
 * `onSweep(record, current)` runs after each one.
 */
async function descend(context, { stage, task = null, axes, start, rungs, forced = {}, cost, isDone, onSweep }) {
  let current = { ...start };
  context.stageBest = -Infinity;
  for (let pass = 1; pass <= context.options.passes; pass += 1) {
    let changed = false;
    for (const axis of axes) {
      if (isDone(pass, axis.name)) continue;
      if (context.measurements.exhausted) return { current, aborted: true };
      let result;
      if (axis.budget && context.contextBudget) {
        const choice = await context.contextBudget(current, axis.patches.map((patch) => patch.contextSize));
        const winner = { contextSize: choice.contextSize };
        result = { stage, task, axis: axis.name, budget: true, reason: choice.reason, rungs: [], previous: { contextSize: current.contextSize }, winner, changed: winner.contextSize !== current.contextSize };
      } else if (axis.greedyNoop && current.temperature === 0) {
        // min-p, top-p and top-k only drop unlikely tokens; a greedy answer cannot change.
        result = { stage, task, axis: axis.name, skippedReason: "temperature 0 (greedy): this setting cannot change the answer", rungs: [], winner: null, changed: false };
      } else {
        result = await sweep(context, { stage, task, axis, current, rungs, forced, cost });
        if (result.aborted) return { current, aborted: true };
      }
      const record = { pass, ...result };
      context.sweeps.push(record);
      context.onEvent({ type: "sweep", stage, task, axis: axis.name, pass, winner: result.winner, changed: Boolean(result.changed), ...(result.kept && { kept: result.kept }), ...(result.reason && { reason: result.reason }), runs: context.measurements.runs });
      if (result.changed) {
        current = { ...current, ...result.winner };
        changed = true;
      }
      await onSweep(record, current);
    }
    if (!changed) break;
  }
  return { current, aborted: false };
}

/**
 * Tune one model. `evaluate(settings, itemIds, seed)` runs the items and
 * resolves `{ prompts: [{ id, passed, total, error?, ms, tokensPerSecond,
 * outputTokens, digest }], memoryBytes? }`. `rungs` maps `load`, `speed` and
 * each task to nested item-id lists. `stages` limits which stages run;
 * `resume` is a progress state from an earlier, unfinished tune;
 * `onProgress(state)` is called after every axis.
 */
export async function tune({
  evaluate,
  base,
  tasks,
  rungs,
  stages = STAGES,
  only = null,
  resume = null,
  // Which items the search ran on, when the caller kept saturated ones out (ADR-064).
  tunedOn = null,
  hardware = {},
  deviceBackends = ["cpu", "vulkan"],
  parallel = 1,
  // Held while a stage times answers, so tunes running side by side pause (ADR-033).
  timing = { acquire: async () => {}, release: async () => {} },
  // (settings, sizes) => { contextSize, reason }: the context that fits in free memory (ADR-043).
  contextBudget = null,
  // (settings, seed, answers) for every newly measured answer.
  onAnswers = () => {},
  // (itemId) => the item's question type, to break each task's result down (ADR-056).
  typeOf = null,
  // (itemId) => the coding view ("write", "fix", "repo") an item belongs to, or null (ADR-070).
  groupOf = null,
  modelLayers = 0,
  qualityAxes = defaultQualityAxes(),
  speedAxes = defaultSpeedAxes(hardware),
  samplingAxes = defaultSamplingAxes,
  promptAxes = defaultPromptAxes,
  options = {},
  onEvent = () => {},
  onProgress = () => {},
}) {
  const settings = { ...DEFAULT_TUNE_OPTIONS, ...options };
  // Never start above the thread cap (three quarters of the logical threads), so no stage takes the whole computer.
  const threadCap = hardware.logicalCores ? Math.max(1, Math.floor(hardware.logicalCores * 0.75)) : Infinity;
  const start = (base.threads ?? 0) > threadCap ? { ...base, threads: threadCap } : base;
  const state = resume ? { ...emptyProgress(), ...structuredClone(resume) } : emptyProgress();
  const context = { options: settings, measurements: new Measurements(evaluate, settings.maxRuns, onAnswers), sweeps: state.sweeps, onEvent, stageBest: -Infinity, valid: isValidCombination, contextBudget, typeOf, groupOf };
  const report = async () => {
    state.runs = (resume?.runs ?? 0) + context.measurements.runs;
    await onProgress(state);
  };
  // With `only`, just those settings run, re-measured even if tuned before (ADR-034).
  const chosen = (axes) => (only ? axes.filter((axis) => only.includes(axis.name)) : axes);
  const wants = (stage, entry, axes) => stages.includes(stage) && (only ? chosen(axes).length > 0 : entry.status !== "done");
  // Store what was tuned before plus what this run measures, never untouched defaults.
  const keysFor = (entry, axes) => [...new Set([...Object.keys(entry.settings), ...axisKeys(chosen(axes))])];
  // A partial selection never marks a stage finished; one finished before stays finished.
  const finished = (entry, axes) => !only || entry.status === "done" || chosen(axes).length === axes.length;
  const progressFor = (entry, keys) => ({
    isDone: (pass, axis) => !only && entry.done.includes(`${pass}:${axis}`),
    onSweep: async (record, current) => {
      entry.done.push(`${record.pass}:${record.axis}`);
      entry.settings = pick(current, keys);
      if (entry.status !== "done") entry.status = "partial";
      await report();
    },
  });
  const loadNow = () => ({ ...start, ...state.device.settings, ...state.quality.settings, ...state.speed.settings });

  const deviceWanted = stages.includes("device") && (only ? only.includes("device") : state.device.status !== "done");
  if (deviceWanted && deviceBackends.length > 1 && rungs.speed?.length) {
    await timing.acquire();
    let outcome;
    try {
      outcome = await deviceStage(context, { backends: deviceBackends, layers: modelLayers, start: loadNow(), items: rungs.speed[0], forced: TIMED });
    } finally {
      await timing.release();
    }
    if (!outcome.aborted) {
      Object.assign(state.device, { status: "done", settings: outcome.settings, probe: outcome.probe, reason: outcome.reason });
      context.onEvent({ type: "sweep", stage: "device", task: null, axis: "device", pass: 1, winner: outcome.settings, changed: outcome.settings.gpuBackend !== "cpu", reason: outcome.reason, runs: context.measurements.runs });
      await report();
    }
  }

  if (wants("quality", state.quality, qualityAxes)) {
    const keys = keysFor(state.quality, qualityAxes);
    const before = loadNow();
    const outcome = await descend(context, { stage: "quality", axes: chosen(qualityAxes), start: before, rungs: rungs.load, forced: GREEDY, cost: parallel > 1 ? "tokens" : "latency", ...progressFor(state.quality, keys) });
    if (!outcome.aborted) {
      // The quality settings are shared by every task: one that clearly hurts a task goes back (ADR-057).
      const check = await perTaskCheck(context, before, outcome.current, keys, rungs.loadByTask);
      if (check?.reverted) outcome.current = { ...outcome.current, ...pick(before, keys) };
      Object.assign(state.quality, { perTask: check?.perTask ?? null, reverted: check?.reverted ?? null });
      const done = finished(state.quality, qualityAxes);
      const stats = done ? await score(context.measurements, { ...outcome.current, ...GREEDY }, rungs.load.at(-1), settings.seeds) : null;
      Object.assign(state.quality, { status: done ? "done" : "partial", settings: pick(outcome.current, keys), stats: stats ? publicStats(stats) : state.quality.stats });
      await report();
    }
  }

  if (wants("speed", state.speed, speedAxes) && speedAxes.length && rungs.speed?.length) {
    const keys = keysFor(state.speed, speedAxes);
    await timing.acquire();
    let outcome;
    try {
      outcome = await speedStage(context, {
        axes: chosen(speedAxes), start: loadNow(), items: rungs.speed[0], forced: TIMED, logicalCores: hardware.logicalCores ?? 8, ...progressFor(state.speed, keys),
      });
    } finally {
      await timing.release();
    }
    if (!outcome.aborted) {
      const fastest = { ...(state.speed.fastest ?? {}), ...outcome.fastest };
      // Light differs from Fastest only in threads; keep its earlier threads unless threads were re-measured.
      const light = chosen(speedAxes).some((axis) => axis.name === "threads") || !state.speed.light
        ? { ...fastest, threads: outcome.light.threads }
        : { ...fastest, threads: state.speed.light.threads };
      // Quiet keeps its earlier thread count too, unless threads were re-measured.
      const quiet = chosen(speedAxes).some((axis) => axis.name === "threads") || !state.speed.quiet
        ? { ...fastest, threads: outcome.quiet.threads }
        : { ...fastest, threads: state.speed.quiet.threads };
      Object.assign(state.speed, { status: finished(state.speed, speedAxes) ? "done" : "partial", settings: pick(outcome.current, keys), fastest, light, quiet });
      await report();
    }
  }

  for (const task of tasks) {
    // The search may run on fewer items than the final check, which keeps the whole set (ADR-064).
    const items = rungs.final?.[task] ?? rungs[task].at(-1);
    const untuned = loadNow();
    let touched = false;
    const sampling = samplingAxes(task);
    state.sampling[task] ??= emptyStage();
    if (wants("sampling", state.sampling[task], sampling)) {
      const entry = state.sampling[task];
      const keys = keysFor(entry, sampling);
      const outcome = await descend(context, { stage: "sampling", task, axes: chosen(sampling), start: { ...untuned, ...entry.settings }, rungs: rungs[task], cost: "tokens", ...progressFor(entry, keys) });
      if (!outcome.aborted) {
        const done = finished(entry, sampling);
        Object.assign(entry, { status: done ? "done" : "partial", settings: pick(outcome.current, keys), stats: done ? await taskStats(context, outcome.current, untuned, items) : entry.stats });
        touched = true;
        await report();
      }
    }
    state.prompt[task] ??= emptyStage();
    const prompts = typeof promptAxes === "function" ? promptAxes(task) : promptAxes;
    if (wants("prompt", state.prompt[task], prompts)) {
      const entry = state.prompt[task];
      const keys = keysFor(entry, prompts);
      const start = { ...untuned, ...(state.sampling[task]?.settings ?? {}), ...entry.settings };
      const outcome = await descend(context, { stage: "prompt", task, axes: chosen(prompts), start, rungs: rungs[task], cost: "tokens", ...progressFor(entry, keys) });
      if (!outcome.aborted) {
        const done = finished(entry, prompts);
        Object.assign(entry, { status: done ? "done" : "partial", settings: pick(outcome.current, keys), stats: done ? await taskStats(context, outcome.current, untuned, items) : entry.stats });
        touched = true;
        await report();
      }
    }
    // Once the task's preset is final, check it on items it was never tuned on (ADR-054).
    const held = rungs.holdout?.[task];
    state.holdout ??= {};
    if (held?.length && (touched || !state.holdout[task]) && state.sampling[task]?.status === "done" && state.prompt[task]?.status === "done") {
      const final = { ...untuned, ...state.sampling[task].settings, ...state.prompt[task].settings };
      const check = await holdoutCheck(context, final, untuned, held);
      if (check) {
        state.holdout[task] = check;
        await report();
      }
    }
  }

  state.runs = (resume?.runs ?? 0) + context.measurements.runs;
  const { stopped } = context.measurements;
  return resultFrom(state, { budgetExhausted: context.measurements.exhausted && !stopped, stopped, tunedOn, options: { ...settings, seeds: [...settings.seeds] } });
}

/**
 * The final preset against the untuned settings on held-back items, paired. A preset worse
 * there than the defaults falls back to them: it fitted the tuning items, not the task.
 */
async function holdoutCheck(context, final, untuned, items) {
  const chosen = await score(context.measurements, final, items, context.options.seeds);
  const before = await score(context.measurements, untuned, items, context.options.seeds);
  if (!chosen || !before) return null;
  return {
    items: items.length,
    rate: chosen.rate,
    ci95: chosen.ci95,
    defaultRate: before.rate,
    vsDefault: { rateDelta: round(chosen.rate - before.rate), ...paired(before, chosen) },
    ...byType(context, chosen, before, items),
    fellBack: chosen.rate < before.rate,
  };
}

/**
 * The shared quality settings against those before the stage, on each task's own load items,
 * paired. A task significantly worse (at `changeAlpha`, uncorrected, to protect every task)
 * reverts the change; the measurements are already cached from the sweep.
 */
async function perTaskCheck(context, before, after, keys, loadByTask) {
  const changed = keys.some((key) => before[key] !== after[key]);
  if (!changed || !loadByTask) return null;
  const perTask = {};
  let reverted = null;
  for (const [task, items] of Object.entries(loadByTask)) {
    const now = await score(context.measurements, { ...after, ...GREEDY }, items, context.options.seeds);
    const then = await score(context.measurements, { ...before, ...GREEDY }, items, context.options.seeds);
    if (!now || !then) continue;
    const evidence = paired(then, now);
    const worse = evidence.b > evidence.c && evidence.pValue <= context.options.changeAlpha;
    perTask[task] = { rate: now.rate, before: then.rate, pValue: evidence.pValue, worse };
    if (worse) reverted ??= task;
  }
  return { perTask, reverted };
}

/** A task's final rate, CI, answer length and the change against the untuned settings. */
async function taskStats(context, final, untuned, items) {
  const chosen = await score(context.measurements, final, items, context.options.seeds);
  const before = await score(context.measurements, untuned, items, context.options.seeds);
  if (!chosen) return null;
  return {
    ...publicStats(chosen),
    vsDefault: before ? { rateDelta: round(chosen.rate - before.rate), ...paired(before, chosen) } : null,
    ...byType(context, chosen, before, items),
  };
}

/**
 * Right answers per question type, for the chosen settings and the defaults, so a setting
 * that helps one kind of question and hurts another shows (ADR-056).
 */
function byType(context, chosen, before, items) {
  if (!context.typeOf) return {};
  const types = {};
  const flips = {};
  for (const id of items) {
    const type = context.typeOf(id) ?? "other";
    const entry = (types[type] ??= { items: 0, right: 0, defaultRight: 0 });
    const flip = (flips[type] ??= { lost: 0, gained: 0 });
    const right = Boolean(chosen.majority.get(id));
    const defaultRight = Boolean(before?.majority.get(id));
    entry.items += 1;
    if (right) entry.right += 1;
    if (defaultRight) entry.defaultRight += 1;
    if (defaultRight && !right) flip.lost += 1;
    if (right && !defaultRight) flip.gained += 1;
  }
  // Each type's own paired test, so a difference too small to tell apart says so (ADR-059).
  if (before) for (const [type, entry] of Object.entries(types)) entry.p = round(mcnemarExact(flips[type].lost, flips[type].gained), 4);
  return { byType: types };
}

/**
 * What a profile stores: only tuned keys, so anything not tuned yet keeps its
 * default when applied. Stage status tells how far the tune got.
 */
export function resultFrom(state, { budgetExhausted = false, stopped = null, options = null, tunedOn = null } = {}) {
  const tasks = {};
  for (const task of new Set([...Object.keys(state.sampling), ...Object.keys(state.prompt)])) {
    const sampling = state.sampling[task];
    const prompt = state.prompt[task];
    const settings = { ...(sampling?.settings ?? {}), ...(prompt?.settings ?? {}) };
    const holdout = state.holdout?.[task] ?? null;
    if (!Object.keys(settings).length && !holdout) continue;
    // A preset worse than the defaults on held-back items is not applied (ADR-054).
    tasks[task] = { settings: holdout?.fellBack ? {} : settings, stats: prompt?.stats ?? sampling?.stats ?? null, ...(holdout && { holdout }) };
  }
  const status = (entry) => entry?.status ?? "pending";
  return {
    load: { settings: { ...state.device.settings, ...state.quality.settings, ...state.speed.settings }, stats: state.quality.stats, ...(state.quality.perTask && { perTask: state.quality.perTask, reverted: state.quality.reverted }) },
    device: state.device.status === "done" ? { settings: state.device.settings, probe: state.device.probe, reason: state.device.reason } : null,
    speed: state.speed.fastest ? { fastest: state.speed.fastest, light: state.speed.light, ...(state.speed.quiet && { quiet: state.speed.quiet }) } : null,
    tasks,
    stages: {
      device: status(state.device),
      quality: status(state.quality),
      speed: status(state.speed),
      sampling: Object.fromEntries(Object.entries(state.sampling).map(([task, entry]) => [task, status(entry)])),
      prompt: Object.fromEntries(Object.entries(state.prompt).map(([task, entry]) => [task, status(entry)])),
    },
    // The sweep log is stored once, beside the progress; a resume puts it back.
    progress: { ...state, sweeps: [] },
    sweeps: state.sweeps,
    runs: state.runs,
    budgetExhausted,
    ...(stopped && { stopped }),
    ...(tunedOn && { tunedOn }),
    options,
  };
}

/** Re-measure fixed presets (no search) on each task's last rung, as the tune gate does. */
export async function measurePresets({ evaluate, load, presets, rungs, options = {} }) {
  const settings = { ...DEFAULT_TUNE_OPTIONS, ...options };
  const measurements = new Measurements(evaluate, Infinity);
  const measured = {};
  for (const [task, preset] of Object.entries(presets)) {
    measured[task] = publicStats(await score(measurements, { ...load, ...preset }, rungs[task].at(-1), settings.seeds));
  }
  return measured;
}
