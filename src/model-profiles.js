import fs from "node:fs";
import path from "node:path";

import { AppError } from "./errors.js";
import { readJsonWithQuarantine, writeJsonAtomic } from "./fs-atomic.js";
import { SUITE_VERSION } from "../benchmarks/suite.mjs";
import { taskSubsetHash } from "../benchmarks/tasks.mjs";
import { MODEL_CATALOG } from "./model-catalog.js";
import { systemInfo } from "./system.js";

/**
 * Tuned settings for one model on this machine (ADR-027): one load config and
 * a sampling preset per task, with the statistics that chose them.
 */
export const PROFILE_SCHEMA = 1;

export const LOAD_KEYS = Object.freeze([
  "contextSize", "kvCache", "flashAttention", "useMmap", "batchSize", "threads",
  "checkpoints", "checkpointInterval", "checkpointMax", "gpuLayers", "gpuBackend",
]);

/** What a profile was measured on; any difference makes it stale. */
export const FINGERPRINT_KEYS = Object.freeze([
  "cpu", "cores", "platform", "arch", "nodeLlamaCpp", "suiteVersion", "taskHash", "modelFile", "modelSize",
]);

const CATALOG_ID = /^[a-z0-9][a-z0-9._-]*$/i;

function fileFor(directory, catalogId) {
  if (typeof catalogId !== "string" || !CATALOG_ID.test(catalogId) || catalogId.includes("..")) {
    throw new AppError("The model profile name is invalid", {
      code: "profile_invalid",
      status: 422,
      why: `"${catalogId}" is not a plain catalog id.`,
      fix: "Tune a model from the catalog or the Models list.",
    });
  }
  return path.join(directory, `${catalogId}.json`);
}

/** The profile name of an installed model file: its catalog id, or a safe form of the file name. */
export function profileIdFor(fileName) {
  const base = path.basename(String(fileName).replace(/\\/g, "/"));
  const catalog = MODEL_CATALOG.find((model) => model.file.toLowerCase() === base.toLowerCase());
  if (catalog) return catalog.id;
  return base.replace(/\.gguf$/i, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "");
}

const pick = (settings, keys) => Object.fromEntries(keys.filter((key) => key in settings).map((key) => [key, settings[key]]));

/** Turn a `tune()` result into a storable profile. */
export function profileFromTune(result, { catalogId, fingerprint, measuredUnder = null, measuredOn = null, createdAt = new Date().toISOString() }) {
  return {
    schema: PROFILE_SCHEMA,
    catalogId,
    createdAt,
    fingerprint: pick(fingerprint, FINGERPRINT_KEYS),
    // Parts measured under another fingerprint than the one above, after a part run (ADR-040).
    ...(measuredUnder && { measuredUnder }),
    // The device (CPU or GPU backend) each part was measured on (ADR-044).
    ...(measuredOn && { measuredOn }),
    load: { settings: pick(result.load.settings, LOAD_KEYS), stats: result.load.stats ?? null },
    device: result.device ?? null,
    speed: result.speed ?? null,
    tasks: Object.fromEntries(Object.entries(result.tasks).map(([task, preset]) => [task, { settings: { ...preset.settings }, stats: preset.stats ?? null }])),
    // How far the tune got; anything not done keeps its default when applied (ADR-030).
    stages: result.stages ?? null,
    progress: result.progress ?? null,
    search: { runs: result.runs, budgetExhausted: result.budgetExhausted, options: result.options ?? null, steps: result.steps ?? null },
    sweeps: result.sweeps ?? [],
  };
}

export const SPEED_PRESETS = Object.freeze(["fastest", "light"]);

/**
 * The settings to apply for a task: the tuned load settings with the chosen
 * speed preset, plus that task's tuned sampling and prompt settings. Only
 * tuned keys are returned, so everything else keeps its default.
 */
export function presetFor(profile, taskId, speedPreset = "fastest") {
  if (!profile) return null;
  const load = { ...profile.load.settings, ...(profile.speed?.[speedPreset] ?? {}) };
  return { ...pick(load, LOAD_KEYS), ...(profile.tasks?.[taskId]?.settings ?? {}) };
}

export async function saveProfile(directory, profile) {
  await writeJsonAtomic(fileFor(directory, profile.catalogId), profile);
}

/** The saved profile and the fingerprint keys that changed since it was measured, or null when there is none. */
export async function loadProfile(directory, catalogId, fingerprint) {
  const profile = await readJsonWithQuarantine(fileFor(directory, catalogId), null);
  if (!profile) return null;
  if (profile.schema !== PROFILE_SCHEMA) {
    throw new AppError("The model profile has an unsupported format", {
      code: "profile_unsupported",
      status: 422,
      why: `${catalogId}.json uses profile schema ${profile.schema}; this ModelDuck reads schema ${PROFILE_SCHEMA}.`,
      fix: "Update ModelDuck, or tune the model again to replace the profile.",
    });
  }
  const differs = (print) => (key) => print?.[key] !== fingerprint?.[key];
  const parts = Object.entries(profile.measuredUnder ?? {});
  const prints = [profile.fingerprint, ...parts.map(([, print]) => print)];
  const stale = FINGERPRINT_KEYS.filter((key) => prints.some((print) => differs(print)(key)));
  const warnings = stale.map((key) => staleWarning(key, prints.find((print) => differs(print)(key))?.[key], fingerprint?.[key]));
  const staleParts = parts.filter(([, print]) => FINGERPRINT_KEYS.some(differs(print))).map(([part]) => part);
  if (staleParts.length) warnings.push(`Measured before that: ${staleParts.join(", ")}; the other parts are up to date.`);
  // Parts measured on another device than the profile now uses; the device part itself decides it.
  const device = profile.load?.settings?.gpuBackend ?? "cpu";
  const onOther = Object.entries(profile.measuredOn ?? {}).filter(([part, backend]) => part !== "device" && backend !== device);
  const deviceParts = onOther.map(([part]) => part);
  if (deviceParts.length) {
    const before = [...new Set(onOther.map(([, backend]) => deviceLabel(backend)))].join(" and ");
    warnings.push(`Measured on ${before}, now on ${deviceLabel(device)}: ${deviceParts.join(", ")}. Run them again so they match the device.`);
  }
  return { profile, stale, staleParts, deviceParts, warnings };
}

const STALE_REASONS = Object.freeze({
  suiteVersion: (saved, now) => `The test suite changed (v${saved} → v${now})`,
  taskHash: () => "The tune's test items changed",
  nodeLlamaCpp: (saved, now) => `The inference runtime changed (node-llama-cpp ${saved} → ${now})`,
  cpu: (saved, now) => `The CPU changed (${saved} → ${now})`,
  cores: (saved, now) => `The CPU thread count changed (${saved} → ${now})`,
  platform: (saved, now) => `The operating system changed (${saved} → ${now})`,
  arch: (saved, now) => `The CPU architecture changed (${saved} → ${now})`,
  modelFile: (saved, now) => `The model file changed (${saved} → ${now ?? "not installed"})`,
  modelSize: () => "The model file's size changed, so it is a different build",
});

/** A stale profile is still used; this says what changed and that a re-tune would refresh it. */
function staleWarning(key, saved, now) {
  return `${STALE_REASONS[key](saved, now)}; these settings were measured before that. Re-tune when convenient.`;
}

let runtimeVersion = null;

/** What a tune measured on right now, for `loadProfile` and for a new profile. */
export async function currentFingerprint(entry, { system = systemInfo(), nodeLlamaCpp } = {}) {
  runtimeVersion ??= import("node-llama-cpp").then((runtime) => runtime.getModuleVersion()).catch(() => "unknown");
  return {
    cpu: system.cpu,
    cores: system.cores,
    platform: system.platform,
    arch: system.arch,
    nodeLlamaCpp: nodeLlamaCpp ?? (await runtimeVersion),
    suiteVersion: SUITE_VERSION,
    taskHash: taskSubsetHash(),
    modelFile: entry ? path.basename(String(entry.fileName).replace(/\\/g, "/")) : null,
    modelSize: entry?.size ?? null,
  };
}

const TUNE_STAGES = Object.freeze(["device", "quality", "speed", "sampling", "prompt"]);

/** The stage (and stage:task) steps of a tune that a profile has not finished yet. */
export function pendingWork(profile, tasks, stages = TUNE_STAGES) {
  const done = profile?.stages ?? {};
  const pending = [];
  for (const stage of ["device", "quality", "speed"]) if (stages.includes(stage) && done[stage] !== "done") pending.push(stage);
  for (const task of tasks) {
    for (const stage of ["sampling", "prompt"]) {
      if (stages.includes(stage) && done[stage]?.[task] !== "done") pending.push(`${stage}:${task}`);
    }
  }
  return pending;
}

/** One summary line per saved profile. */
export async function listProfiles(directory) {
  let names;
  try {
    names = await fs.promises.readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const profiles = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const profile = await readJsonWithQuarantine(path.join(directory, name), null);
    if (profile?.schema !== PROFILE_SCHEMA) continue;
    profiles.push({ catalogId: profile.catalogId, createdAt: profile.createdAt, tasks: Object.keys(profile.tasks ?? {}) });
  }
  return profiles;
}

/**
 * Reuse before re-tuning (ADR-028, ADR-030): skip when the saved profile has
 * finished every requested stage, resume from its saved progress otherwise,
 * and refuse to add new results to a stale profile.
 */
/** The parts a tune measures for `stages` and `tasks`: device, quality and speed once, sampling and prompt per task. */
export function profileParts(stages, tasks) {
  const parts = ["device", "quality", "speed"].filter((stage) => stages.includes(stage));
  for (const stage of ["sampling", "prompt"]) if (stages.includes(stage)) parts.push(...tasks.map((task) => `${stage}:${task}`));
  return parts;
}

const statusOf = (stages, part) => {
  const [stage, task] = part.split(":");
  return (task ? stages?.[stage]?.[task] : stages?.[stage]) ?? "pending";
};

/** Saved progress with `parts` removed, so a resumed tune measures them from scratch on top of the rest. */
function withoutParts(progress, parts) {
  const copy = structuredClone(progress);
  for (const part of parts) {
    const [stage, task] = part.split(":");
    if (task) delete copy[stage]?.[task];
    else delete copy[stage];
  }
  return copy;
}

/**
 * After a run, the fingerprint each measured part was measured under: parts
 * measured now (re-run or new) get the current one, the rest keep theirs.
 * Null when every part is current, so a profile only carries it when it matters.
 */
export function measuredUnderAfter(saved, fingerprint, stages, rerun) {
  const current = pick(fingerprint ?? {}, FINGERPRINT_KEYS);
  if (!saved) return null;
  const before = saved.profile.measuredUnder ?? {};
  const map = {};
  for (const part of measuredParts(stages)) {
    const measuredNow = rerun.includes(part) || statusOf(saved.profile.stages, part) === "pending";
    map[part] = measuredNow ? current : before[part] ?? pick(saved.profile.fingerprint ?? {}, FINGERPRINT_KEYS);
  }
  const same = (print) => FINGERPRINT_KEYS.every((key) => print[key] === current[key]);
  return Object.values(map).every(same) ? null : map;
}

const deviceLabel = (backend) => (backend === "cpu" ? "the CPU" : `the ${backend} GPU`);

/** The parts a result has measured (done or partly done): device, quality and speed once, sampling and prompt per task. */
function measuredParts(stages) {
  const parts = Object.keys(stages ?? {}).flatMap((stage) =>
    stages[stage] && typeof stages[stage] === "object" ? Object.keys(stages[stage]).map((task) => `${stage}:${task}`) : [stage]);
  return parts.filter((part) => statusOf(stages, part) !== "pending");
}

/**
 * After a run, the device each measured part was measured on: parts measured now get
 * `backend`, the rest keep theirs (for a profile from before this record, the device it
 * was on).
 */
export function measuredOnAfter(saved, stages, rerun, backend) {
  const before = saved?.profile.measuredOn ?? {};
  const previous = saved?.profile.load?.settings?.gpuBackend ?? null;
  const map = {};
  for (const part of measuredParts(stages)) {
    const measuredNow = !saved || rerun.includes(part) || statusOf(saved.profile.stages, part) === "pending";
    const on = measuredNow ? backend : before[part] ?? previous;
    if (on) map[part] = on;
  }
  return map;
}

/** A run of some stages or some settings rather than the whole tune (ADR-040). */
export function isPartRun(stages, only) {
  return Boolean(only?.length) || TUNE_STAGES.some((stage) => !(stages ?? TUNE_STAGES).includes(stage));
}

export function planTune(saved, tasks, stages = TUNE_STAGES, only = null) {
  if (!saved) return { resume: null };
  // Choosing some stages or settings measures those parts again on top of the saved rest,
  // even when they are done or the profile is stale (ADR-040); a partial stage resumes.
  if (isPartRun(stages, only) && saved.profile.progress) {
    const rerun = only?.length ? [] : profileParts(stages, tasks).filter((part) => statusOf(saved.profile.stages, part) === "done");
    return { resume: { ...withoutParts(saved.profile.progress, rerun), sweeps: saved.profile.sweeps ?? [] }, rerun };
  }
  // An explicit choice of settings always runs (ADR-034); otherwise only unfinished work does.
  const pending = only?.length ? only : pendingWork(saved.profile, tasks, stages);
  if (!pending.length) return { skip: true };
  if (saved.stale.length) {
    throw new AppError("The saved profile is out of date", {
      code: "tune_profile_stale",
      why: `It has not finished ${pending.join(", ")}, and its other results were measured before: ${saved.warnings.join(" ")}`,
      fix: "Re-tune with --force so all results come from the same test and machine.",
    });
  }
  if (!saved.profile.progress) return { resume: null };
  return { resume: { ...saved.profile.progress, sweeps: saved.profile.sweeps ?? [] } };
}
