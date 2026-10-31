import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { answersFile, listRuns, loadRun, startRun } from "../src/tune-runs.js";

async function runsDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "modelduck-runs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const REQUEST = { stages: ["prompt"], tasks: ["code"], only: null, force: false };

test("a tune run keeps its summary and every answer, and ends with its outcome", async (t) => {
  const dir = await runsDir(t);
  const run = await startRun(dir, { profileId: "qwen2.5-coder-1.5b-instruct-q4", model: "coder.gguf", request: REQUEST, fingerprint: { suiteVersion: 11 }, expectedAnswers: 480, now: new Date("2026-10-31T17:00:00Z") });
  await run.answers([
    { settings: { systemPrompt: "A" }, seed: 42, item: "code-1", passed: 1, total: 1, ms: 120, outputTokens: 30 },
    { settings: { systemPrompt: "A" }, seed: 42, item: "code-2", passed: 0, total: 1, ms: 140, outputTokens: 33 },
  ]);
  await run.update({ answers: 2, sweeps: [{ axis: "systemPrompt" }] });
  await run.finish({ outcome: "done", now: new Date("2026-10-31T17:10:00Z") });

  const saved = await loadRun(dir, run.id);
  assert.equal(saved.outcome, "done");
  assert.equal(saved.durationMs, 10 * 60_000);
  assert.deepEqual(saved.request, REQUEST);
  assert.equal(saved.expectedAnswers, 480);
  assert.deepEqual(saved.sweeps, [{ axis: "systemPrompt" }]);
  const lines = (await readFile(answersFile(dir, run.id), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => [line.item, line.passed]), [["code-1", 1], ["code-2", 0]]);
});

test("runs are listed newest first, and one whose process died while running shows as interrupted", async (t) => {
  const dir = await runsDir(t);
  const older = await startRun(dir, { profileId: "a", model: "a.gguf", request: REQUEST, now: new Date("2026-10-30T10:00:00Z"), pid: 111 });
  await older.finish({ outcome: "stopped", error: "could not load", now: new Date("2026-10-30T10:01:00Z") });
  await startRun(dir, { profileId: "b", model: "b.gguf", request: REQUEST, now: new Date("2026-10-31T10:00:00Z"), pid: 222 });
  const runs = await listRuns(dir, { isAlive: (pid) => pid !== 222 });
  assert.deepEqual(runs.map((run) => [run.profileId, run.outcome]), [["b", "interrupted"], ["a", "stopped"]]);
  assert.equal(runs[1].error, "could not load");
  assert.equal(runs[0].sweeps, undefined, "the listing leaves out the details");
});

test("a run id that could leave the folder is refused", async (t) => {
  const dir = await runsDir(t);
  await assert.rejects(loadRun(dir, "../profiles/x"), (error) => error.code === "tune_run_bad_id");
  assert.throws(() => answersFile(dir, "..\\secret"), (error) => error.code === "tune_run_bad_id");
  assert.equal(await loadRun(dir, "2026-01-01T00-00-00-000Z-1"), null, "an unknown run is simply missing");
});
