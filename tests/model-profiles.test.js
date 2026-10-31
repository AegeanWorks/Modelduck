import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolvePaths } from "../src/config.js";
import { MODEL_CATALOG } from "../src/model-catalog.js";
import {
  FINGERPRINT_KEYS,
  PROFILE_SCHEMA,
  currentFingerprint,
  listProfiles,
  loadProfile,
  pendingWork,
  planTune,
  presetFor,
  profileFromTune,
  profileIdFor,
  saveProfile,
} from "../src/model-profiles.js";

const FINGERPRINT = Object.freeze({
  cpu: "Test CPU",
  cores: 8,
  platform: "win32",
  arch: "x64",
  nodeLlamaCpp: "3.22.2",
  suiteVersion: 8,
  taskHash: "abc123",
  modelFile: "qwen.gguf",
  modelSize: 1000,
});

const TUNE = {
  load: { settings: { contextSize: 8192, threads: 8, kvCache: "q8_0", temperature: 0.7, maxTokens: 512 }, stats: { rate: 90 } },
  tasks: {
    code: { settings: { temperature: 0.2, maxTokens: 1024 }, stats: { rate: 75, vsDefault: { rateDelta: 10, b: 0, c: 2, pValue: 0.5 } } },
    math: { settings: { temperature: 0, maxTokens: 768 }, stats: { rate: 60 } },
  },
  speed: { fastest: { threads: 8, batchSize: 512 }, light: { threads: 4, batchSize: 512 } },
  stages: { device: "done", quality: "done", speed: "done", sampling: { code: "done", math: "done" }, prompt: { code: "done", math: "partial" } },
  progress: { quality: { status: "done" }, sweeps: [] },
  sweeps: [{ stage: "speed", axis: "threads", rungs: [] }],
  runs: 321,
  budgetExhausted: false,
  options: { seeds: [42], passes: 2 },
};

async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "modelduck-profiles-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const profile = () => profileFromTune(TUNE, { catalogId: "qwen2.5-0.5b-instruct-q4", fingerprint: FINGERPRINT, createdAt: "2026-10-30T20:00:00.000Z" });

test("profiles live under the data folder", () => {
  const home = path.join(os.tmpdir(), "duck-home");
  assert.equal(resolvePaths({ home }).profiles, path.join(path.resolve(home), "profiles"));
});

test("a tune becomes a profile with load settings, task presets and its statistics", () => {
  const value = profile();
  assert.equal(value.schema, PROFILE_SCHEMA);
  assert.deepEqual(value.load.settings, { contextSize: 8192, threads: 8, kvCache: "q8_0" }, "sampling keys are not load settings");
  assert.equal(value.tasks.code.stats.vsDefault.rateDelta, 10);
  assert.equal(value.search.runs, 321);
  assert.equal(value.sweeps.length, 1);
});

test("a task preset is the tuned load settings, the speed preset and that task's settings", () => {
  assert.deepEqual(presetFor(profile(), "code"), { contextSize: 8192, threads: 8, kvCache: "q8_0", batchSize: 512, temperature: 0.2, maxTokens: 1024 });
  assert.equal(presetFor(profile(), "code", "light").threads, 4, "Light keeps half the threads free");
  assert.deepEqual(presetFor(profile(), "recall"), { contextSize: 8192, threads: 8, kvCache: "q8_0", batchSize: 512 }, "an untuned task keeps its default sampling");
  assert.equal(presetFor(null, "code"), null);
});

test("a profile keeps its speed presets, stage status and progress", () => {
  const value = profile();
  assert.equal(value.speed.light.threads, 4);
  assert.equal(value.stages.prompt.math, "partial");
  assert.equal(value.progress.quality.status, "done");
});

test("a saved profile loads back fresh on the same machine", async (t) => {
  const dir = await directory(t);
  await saveProfile(dir, profile());
  const loaded = await loadProfile(dir, "qwen2.5-0.5b-instruct-q4", FINGERPRINT);
  assert.deepEqual(loaded.profile, profile());
  assert.deepEqual(loaded.stale, []);
  assert.equal(await loadProfile(dir, "smollm2-135m", FINGERPRINT), null);
});

test("a profile is stale when the hardware, runtime, suite or model file changes", async (t) => {
  const dir = await directory(t);
  await saveProfile(dir, profile());
  const changed = { ...FINGERPRINT, cpu: "Other CPU", nodeLlamaCpp: "3.23.0", taskHash: "def456", modelSize: 2000 };
  const { stale, warnings, profile: kept } = await loadProfile(dir, "qwen2.5-0.5b-instruct-q4", changed);
  assert.deepEqual(stale.sort(), ["cpu", "modelSize", "nodeLlamaCpp", "taskHash"]);
  assert.equal(kept.catalogId, "qwen2.5-0.5b-instruct-q4", "a stale profile is still returned for use");
  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((text) => /test items changed/i.test(text)));
  assert.ok(warnings.some((text) => /3\.22\.2 → 3\.23\.0/.test(text)));
});

test("a suite version change is reported with both versions", async (t) => {
  const dir = await directory(t);
  await saveProfile(dir, profile());
  const { warnings } = await loadProfile(dir, "qwen2.5-0.5b-instruct-q4", { ...FINGERPRINT, suiteVersion: 9 });
  assert.match(warnings[0], /test suite changed \(v8 → v9\)/i);
  assert.match(warnings[0], /re-tune/i);
});

test("the current fingerprint names this machine, runtime, test and model file", async () => {
  const value = await currentFingerprint({ fileName: "sub/qwen.gguf", size: 77 }, { nodeLlamaCpp: "9.9.9" });
  assert.deepEqual(Object.keys(value).sort(), [...FINGERPRINT_KEYS].sort());
  assert.equal(value.modelFile, "qwen.gguf");
  assert.equal(value.modelSize, 77);
  assert.equal(value.nodeLlamaCpp, "9.9.9");
  assert.match(value.taskHash, /^[a-f0-9]{16}$/);
});

test("unfinished stages are listed per task", () => {
  assert.deepEqual(pendingWork(profile(), ["code", "math", "recall"]), ["prompt:math", "sampling:recall", "prompt:recall"]);
  assert.deepEqual(pendingWork(profile(), ["code"], ["quality", "speed"]), []);
  assert.deepEqual(pendingWork(null, ["code"], ["quality"]), ["quality"]);
});

test("an unsupported schema is refused and left untouched", async (t) => {
  const dir = await directory(t);
  const file = path.join(dir, "qwen2.5-0.5b-instruct-q4.json");
  const text = JSON.stringify({ ...profile(), schema: 99 });
  await writeFile(file, text);
  await assert.rejects(loadProfile(dir, "qwen2.5-0.5b-instruct-q4", FINGERPRINT), (error) => error.code === "profile_unsupported" && /99/.test(error.why));
  assert.equal(await readFile(file, "utf8"), text);
});

test("a catalog id that is not a plain file name is refused", async (t) => {
  const dir = await directory(t);
  await assert.rejects(saveProfile(dir, { ...profile(), catalogId: "../escape" }), (error) => error.code === "profile_invalid");
  await assert.rejects(loadProfile(dir, "..\\escape", FINGERPRINT), (error) => error.code === "profile_invalid");
});

test("a model file maps to its catalog id, or to a safe name for an imported file", () => {
  const catalog = MODEL_CATALOG[0];
  assert.equal(profileIdFor(catalog.file), catalog.id);
  assert.equal(profileIdFor(`sub/${catalog.file.toUpperCase()}`), catalog.id);
  assert.equal(profileIdFor("My Model (v2).Q4_K_M.gguf"), "my-model-v2-.q4_k_m");
});

test("listing returns every saved profile by model", async (t) => {
  const dir = await directory(t);
  assert.deepEqual(await listProfiles(path.join(dir, "missing")), []);
  await saveProfile(dir, profile());
  await saveProfile(dir, { ...profile(), catalogId: "smollm2-135m-instruct-q8" });
  await writeFile(path.join(dir, "notes.txt"), "ignored");
  assert.deepEqual((await listProfiles(dir)).map((item) => item.catalogId).sort(), ["qwen2.5-0.5b-instruct-q4", "smollm2-135m-instruct-q8"]);
});

test("a tune reuses what is saved before measuring again", () => {
  const fresh = { profile: profile(), stale: [], warnings: [] };
  assert.deepEqual(planTune(null, ["code"]), { resume: null });
  assert.deepEqual(planTune(fresh, ["code"]), { skip: true });
  assert.deepEqual(planTune(fresh, ["code", "math"]), { resume: { ...profile().progress, sweeps: profile().sweeps } }, "math's prompt stage is unfinished");
  const stale = { ...fresh, stale: ["suiteVersion"], warnings: ["The test suite changed (v8 → v9)."] };
  assert.deepEqual(planTune(stale, ["code"]), { skip: true }, "a stale profile is still used, with its warning");
  assert.throws(() => planTune(stale, ["recall"]), (error) => error.code === "tune_profile_stale" && /--force/.test(error.fix));
});

test("an explicit selection of settings always runs, resuming the saved progress", () => {
  const fresh = { profile: profile(), stale: [], warnings: [] };
  assert.deepEqual(planTune(fresh, ["code"], undefined, ["contextSize"]), { resume: { ...profile().progress, sweeps: profile().sweeps } });
  const stale = { ...fresh, stale: ["suiteVersion"], warnings: ["changed"] };
  assert.throws(() => planTune(stale, ["code"], undefined, ["contextSize"]), (error) => error.code === "tune_profile_stale");
});
