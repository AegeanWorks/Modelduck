import path from "node:path";

import { DEFAULT_SETTINGS, resolvePaths } from "../src/config.js";
import { LlamaEngine } from "../src/engine.js";
import { AppError } from "../src/errors.js";
import { getCatalogModel } from "../src/model-catalog.js";
import { currentFingerprint, loadProfile, measuredUnderAfter, planTune, profileFromTune, profileIdFor, saveProfile } from "../src/model-profiles.js";
import { createModelRegistry } from "../src/model-registry.js";
import { systemInfo } from "../src/system.js";
import { createTimingLock } from "../src/tune-lock.js";
import { readSteps } from "../src/tune-steps.js";
import { SYSTEM_PROMPT } from "./suite.mjs";
import { tuneRungs } from "./tasks.mjs";
import { STAGES, resultFrom, tune } from "./tune.mjs";
import { promptAxes, qualityAxes, samplingAxes, speedAxes } from "./tune-grid.mjs";
import { createEvaluator } from "./tune-evaluate.mjs";

/** One installed model, ready to tune or measure: where it is, its profile name and what it runs on. */
export async function openTarget({ model, home, modelsDir }) {
  const paths = resolvePaths({ home, models: modelsDir });
  const registry = createModelRegistry({ modelsDir: paths.models });
  await registry.scan();
  const fileName = (getCatalogModel(model)?.file ?? model).toLowerCase();
  const match = registry.listPublic().find((item) => item.id === model || path.basename(item.fileName).toLowerCase() === fileName);
  if (!match) {
    throw new AppError("That model is not installed", {
      code: "tune_model_missing",
      why: `No installed model matches "${model}".`,
      fix: "Install it from Models → Discover, or pass the catalog id or file name of an installed model.",
    });
  }
  const entry = registry.findById(match.id);
  const system = systemInfo();
  return { paths, registry, entry, profileId: profileIdFor(entry.fileName), system, fingerprint: await currentFingerprint(entry, { system }) };
}

/** Run `fn(engine)` on a fresh engine and always release the model. */
export async function withEngine(target, fn) {
  const engine = new LlamaEngine({ registry: target.registry });
  try {
    return await fn(engine);
  } finally {
    await engine.unload().catch(() => {});
    await engine.dispose().catch(() => {});
  }
}

/** Where every tune starts and every gate measures from: app defaults, answering like the benchmark (suite system prompt, reasoning off). */
export function tuneBase() {
  const { systemPrompt: _systemPrompt, ...defaults } = DEFAULT_SETTINGS;
  return { ...defaults, systemPrompt: SYSTEM_PROMPT, reasoning: "off", promptRepeat: 1 };
}

/**
 * Tune a target in stages, reusing its saved profile (ADR-028, ADR-030).
 * The profile is saved after every finished setting, so stopping keeps what
 * was found and a later run resumes. Resolves `{ skipped, warnings, profile, result }`.
 */
export async function runTune(target, { tasks, stages = STAGES, only = null, steps = null, force = false, maxRuns = 0, passes = 0, onEvent = () => {}, onStart = () => {} }) {
  const saved = force ? null : await loadProfile(target.paths.profiles, target.profileId, target.fingerprint);
  const plan = planTune(saved, tasks, stages, only);
  const warnings = saved?.warnings ?? [];
  if (plan.skip) return { skipped: true, warnings, profile: saved.profile, result: null };
  onStart(plan);
  const base = tuneBase();
  const logicalCores = target.system.parallelism;
  const used = steps ?? (await readSteps(target.paths.tuneGrid)).steps;
  const save = async (result) => {
    const measuredUnder = measuredUnderAfter(saved, target.fingerprint, result.stages, plan.rerun ?? []);
    const profile = profileFromTune({ ...result, steps: used }, { catalogId: target.profileId, fingerprint: target.fingerprint, measuredUnder });
    await saveProfile(target.paths.profiles, profile);
    return profile;
  };
  // Tunes running side by side pause while one of them times something (ADR-033).
  const lock = createTimingLock({ dir: path.join(target.paths.home, "tune-lanes") });
  await lock.register();
  // Even if the process is stopped mid-tune, its registration must not linger.
  const cleanUp = () => lock.unregisterSync();
  process.once("exit", cleanUp);
  const result = await withEngine(target, (engine) => tune({
    evaluate: createEvaluator({ engine, modelId: target.entry.id, beforeAnswer: () => lock.pauseIfNeeded() }),
    timing: { acquire: () => lock.acquire(), release: () => lock.release() },
    base,
    tasks,
    stages,
    only,
    resume: plan.resume,
    rungs: tuneRungs(tasks),
    hardware: { logicalCores },
    deviceBackends: used.device.backends,
    modelLayers: target.entry.kvShape?.layers ?? 0,
    qualityAxes: qualityAxes(used.load),
    speedAxes: speedAxes({ logicalCores }, used.load),
    samplingAxes: (task) => samplingAxes(task, used.sampling),
    promptAxes: promptAxes(used.prompt),
    options: { ...(maxRuns > 0 && { maxRuns }), ...(passes > 0 && { passes }) },
    onEvent,
    onProgress: (state) => save(resultFrom(state)),
  })).finally(() => {
    process.off("exit", cleanUp);
    return lock.unregister();
  });
  return { skipped: false, warnings, profile: await save(result), result };
}

const shown = (value) => (typeof value === "string" && value.length > 48 ? `"${value.slice(0, 45)}…"` : typeof value === "string" ? `"${value}"` : value);
const line = (settings) => Object.entries(settings).map(([key, value]) => `${key}=${shown(value)}`).join(" ") || "(defaults)";

/** Terse report: how far each stage got, the load and speed presets, and each task's rate with its 95% CI. */
export function summary(profile, result = null) {
  const stages = profile.stages ?? {};
  const perTask = (entry) => Object.entries(entry ?? {}).map(([task, status]) => `${task} ${status}`).join(", ") || "pending";
  const lines = [
    `Stages: device ${stages.device ?? "pending"} · quality ${stages.quality ?? "pending"} · speed ${stages.speed ?? "pending"} · sampling ${perTask(stages.sampling)} · prompt ${perTask(stages.prompt)}`,
    `Load: ${line(profile.load.settings)}`,
  ];
  if (profile.device) lines.push(`Device: ${profile.device.reason}`);
  if (profile.speed) lines.push(`Speed presets: Fastest ${line(profile.speed.fastest)} · Light ${line(profile.speed.light)}`);
  for (const [task, preset] of Object.entries(profile.tasks)) {
    const stats = preset.stats;
    const delta = stats?.vsDefault ? ` (${stats.vsDefault.rateDelta >= 0 ? "+" : ""}${stats.vsDefault.rateDelta} pts vs defaults, p=${stats.vsDefault.pValue})` : "";
    lines.push(`${task.padEnd(6)} ${stats ? `${stats.rate}% [${stats.ci95.low}-${stats.ci95.high}] · ${stats.outputTokens ?? "?"} tokens/answer` : "in progress"}${delta}`);
    lines.push(`       ${line(preset.settings)}`);
  }
  if (result) lines.push(`${result.runs} item answers${result.budgetExhausted ? " (run budget reached; resume to continue)" : ""}`);
  return lines.join("\n");
}
