import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_STEPS } from "../benchmarks/tune-grid.mjs";
import { resolvePaths } from "../src/config.js";
import { readSteps, writeSteps } from "../src/tune-steps.js";

async function file(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "modelduck-steps-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, "tune-grid.json");
}

test("the step file lives in the data folder", () => {
  const home = path.join(os.tmpdir(), "duck-home");
  assert.equal(resolvePaths({ home }).tuneGrid, path.join(path.resolve(home), "tune-grid.json"));
});

test("without a step file the defaults are used", async (t) => {
  const loaded = await readSteps(await file(t));
  assert.equal(loaded.custom, false);
  assert.deepEqual(loaded.steps, JSON.parse(JSON.stringify(DEFAULT_STEPS)));
  assert.deepEqual(loaded.problems, []);
});

test("saved steps are cleaned, written and read back", async (t) => {
  const target = await file(t);
  const saved = await writeSteps(target, { load: { threads: [8, 4, 4, 99] } });
  assert.deepEqual(saved.steps.load.threads, [4, 8]);
  assert.ok(saved.problems.some((problem) => problem.includes("threads 99")));
  const loaded = await readSteps(target);
  assert.equal(loaded.custom, true);
  assert.deepEqual(loaded.steps.load.threads, [4, 8]);
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")).load.threads, [4, 8]);
});
