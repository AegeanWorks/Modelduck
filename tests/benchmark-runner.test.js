import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { BenchmarkRunner } from "../src/benchmark-runner.js";

const SCRIPT = path.join("benchmarks", "run.mjs");

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return true;
  };
  return child;
}

function harness({ child = fakeChild() } = {}) {
  const calls = [];
  const runner = new BenchmarkRunner({
    benchmarkDir: path.join("project", "benchmarks"),
    modelsDir: path.join("project", "models"),
    scriptPath: SCRIPT,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
  });
  return { runner, calls, child };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a run starts one child with events and the selected options", () => {
  const { runner, calls } = harness();
  const job = runner.start({ phase: "model", updateBaseline: true, download: true });
  assert.equal(job.status, "running");
  assert.equal(job.phase, "model");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [
    SCRIPT, "--phase", "model", "--events", "--update-baseline", "--download",
    "--models-dir", path.join("project", "models"),
  ]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.throws(() => runner.start({ phase: "chat" }), /already running/);
});

test("the full six-model matrix is opt-in and named in the job", () => {
  const { runner, calls } = harness();
  const job = runner.start({ phase: "model", fullMatrix: true });
  assert.equal(job.fullMatrix, true);
  assert.ok(calls[0].args.includes("--full-matrix"));
});

test("a single-model diagnostic is passed to the child", () => {
  const { runner, calls } = harness();
  const job = runner.start({ phase: "model", model: "qwen2.5-0.5b-instruct-q4" });
  assert.equal(job.model, "qwen2.5-0.5b-instruct-q4");
  const index = calls[0].args.indexOf("--model");
  assert.ok(index >= 0);
  assert.equal(calls[0].args[index + 1], "qwen2.5-0.5b-instruct-q4");
});

test("progress events replace the snapshot and plain lines stay in a bounded log", async () => {  const { runner, child } = harness();
  runner.start({ phase: "chat" });
  child.stdout.write(`${JSON.stringify({ type: "variant", index: 2, total: 12, label: "Qwen" })}\n`);
  child.stdout.write("Downloading Qwen...\n");
  child.stderr.write("[bench] warning\n");
  await tick();
  const job = runner.get();
  assert.equal(job.progress.type, "variant");
  assert.equal(job.progress.index, 2);
  assert.deepEqual(job.log, ["Downloading Qwen...", "[bench] warning"]);
  for (let index = 0; index < 40; index += 1) child.stdout.write(`line ${index}\n`);
  await tick();
  assert.equal(runner.get().log.length, 20);
  assert.equal(runner.get().log.at(-1), "line 39");
});

test("a clean exit completes the job and keeps the last event", async () => {
  const { runner, child } = harness();
  runner.start({ phase: "model" });
  child.stdout.write(`${JSON.stringify({ type: "complete", phase: "model", quality: 81.5 })}\n`);
  await tick();
  child.emit("close", 0, null);
  const job = runner.get();
  assert.equal(job.status, "complete");
  assert.equal(job.exitCode, 0);
  assert.equal(job.progress.quality, 81.5);
  assert.ok(job.finishedAt);
});

test("a failed exit reports the last log line as the reason", async () => {
  const { runner, child } = harness();
  runner.start({ phase: "model" });
  child.stderr.write("[bench] Missing benchmark model: Phi\n");
  await tick();
  child.emit("close", 1, null);
  const job = runner.get();
  assert.equal(job.status, "failed");
  assert.equal(job.error.message, "The benchmark stopped before it finished");
  assert.match(job.error.why, /Missing benchmark model/);
});

test("cancel stops the child and marks the run cancelled", async () => {
  const { runner, child } = harness();
  runner.start({ phase: "model" });
  const cancelling = runner.cancel();
  assert.equal(cancelling.cancelling, true);
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
  child.emit("close", null, "SIGTERM");
  assert.equal(runner.get().status, "cancelled");
  assert.throws(() => runner.cancel(), /No benchmark is running/);
});

test("a spawn failure and no job are reported without throwing at the caller", () => {
  const runner = new BenchmarkRunner({
    benchmarkDir: "benchmarks",
    scriptPath: SCRIPT,
    spawnImpl: () => {
      throw new Error("spawn ENOENT");
    },
  });
  const job = runner.start({ phase: "model" });
  assert.equal(job.status, "failed");
  assert.match(job.error.why, /ENOENT/);
});

test("a tune runs the tune script for one model and its tasks, saving into the data folder", () => {
  const calls = [];
  const runner = new BenchmarkRunner({
    benchmarkDir: path.join("project", "benchmarks"),
    modelsDir: path.join("project", "models"),
    homeDir: path.join("project", "home"),
    scriptPath: SCRIPT,
    tuneScriptPath: path.join("benchmarks", "tune-run.mjs"),
    spawnImpl: (command, args) => {
      calls.push({ command, args });
      return fakeChild();
    },
  });
  const job = runner.start({ phase: "tune", model: "qwen2.5-0.5b-instruct-q4", tasks: ["code", "math"] });
  assert.equal(job.phase, "tune");
  assert.deepEqual(job.tasks, ["code", "math"]);
  const { args } = calls[0];
  assert.equal(args[0], path.join("benchmarks", "tune-run.mjs"));
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value("--model"), "qwen2.5-0.5b-instruct-q4");
  assert.equal(value("--tasks"), "code,math");
  assert.equal(value("--home"), path.join("project", "home"));
  assert.equal(value("--models-dir"), path.join("project", "models"));
  assert.ok(args.includes("--events"));
  assert.equal(args.includes("--force"), false, "a saved profile is reused unless forced");
});

test("a forced tune asks the child to re-tune", () => {
  const { runner, calls } = harness();
  const job = runner.start({ phase: "tune", model: "smollm2-135m-instruct-q4", force: true });
  assert.equal(job.force, true);
  assert.ok(calls[0].args.includes("--force"));
});

test("a tune can run only some stages", () => {
  const { runner, calls } = harness();
  const job = runner.start({ phase: "tune", model: "smollm2-135m-instruct-q4", stages: ["quality", "speed"] });
  assert.deepEqual(job.stages, ["quality", "speed"]);
  const { args } = calls[0];
  assert.equal(args[args.indexOf("--stages") + 1], "quality,speed");
});

test("a tune needs a model", () => {
  const { runner, calls } = harness();
  assert.throws(() => runner.start({ phase: "tune" }), (error) => error.code === "tune_model_required");
  assert.equal(calls.length, 0);
});

test("a tune of only some settings passes them to the child", () => {
  const { runner, calls } = harness();
  runner.start({ phase: "tune", model: "smollm2-135m-instruct-q4", settings: ["contextSize"] });
  assert.equal(calls[0].args[calls[0].args.indexOf("--settings") + 1], "contextSize");
});
