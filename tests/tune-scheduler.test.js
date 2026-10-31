import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { TuneScheduler } from "../src/tune-scheduler.js";

/** A fake spawner: every child stays running until the test ends it. */
function spawner() {
  const children = [];
  const spawnImpl = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.args = args;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit("close", null, "SIGTERM"));
      return true;
    };
    child.finish = (code = 0, events = []) => {
      for (const event of events) child.stdout.write(`${JSON.stringify(event)}\n`);
      setImmediate(() => child.emit("close", code, null));
    };
    children.push(child);
    return child;
  };
  return { spawnImpl, children };
}

const value = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let index = 0; index < 5; index += 1) await tick();
};
const MODELS = [
  { id: "a", fileName: "smol.gguf", profileId: "smol", name: "Smol" },
  { id: "b", fileName: "qwen.gguf", profileId: "qwen", name: "Qwen" },
  { id: "c", fileName: "coder.gguf", profileId: "coder", name: "Coder" },
  { id: "d", fileName: "phi.gguf", profileId: "phi", name: "Phi" },
];
const GPU = new Set(["qwen", "coder", "phi"]);

function scheduler(spawn, { lanes = { cpu: 1, gpu: 2 } } = {}) {
  return new TuneScheduler({
    homeDir: "home",
    modelsDir: "models",
    scriptPath: "tune-run.mjs",
    spawnImpl: spawn.spawnImpl,
    readLanes: async () => lanes,
    readLane: async (model) => (GPU.has(model.profileId) ? "gpu" : "cpu"),
    logger: { warn() {} },
  });
}

async function finishProbes(spawn) {
  for (let index = 0; index < MODELS.length; index += 1) {
    await settle();
    const running = spawn.children.filter((child) => !child.done);
    assert.equal(running.length, 1, "device probes run one at a time");
    assert.equal(value(running[0].args, "--stages"), "device");
    running[0].done = true;
    running[0].finish(0);
  }
  await settle();
}

test("device probes run one at a time, then tunes run in 1 CPU + 2 GPU lanes", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS });
  await finishProbes(spawn);
  const tunes = spawn.children.filter((child) => value(child.args, "--stages") !== "device");
  assert.deepEqual(tunes.map((child) => value(child.args, "--model")).sort(), ["coder.gguf", "qwen.gguf", "smol.gguf"], "Smol on the CPU, two GPU models; Phi waits");
  assert.equal(value(tunes[0].args, "--stages"), "quality,speed,sampling,prompt");
  const job = runner.get();
  assert.equal(job.items.find((item) => item.profileId === "phi").status, "queued");
  assert.equal(job.items.find((item) => item.profileId === "smol").lane, "cpu");

  tunes.find((child) => value(child.args, "--model") === "qwen.gguf").finish(0, [{ type: "complete", phase: "tune" }]);
  await settle();
  assert.ok(spawn.children.some((child) => value(child.args, "--model") === "phi.gguf" && value(child.args, "--stages") !== "device"), "Phi takes the freed GPU lane");
  for (const child of spawn.children.filter((item) => !item.done && value(item.args, "--stages") !== "device")) child.finish(0);
  await settle();
  for (const child of spawn.children.filter((item) => value(item.args, "--model") === "phi.gguf" && value(item.args, "--stages") !== "device")) child.finish(0);
  await settle();
  assert.equal(runner.get().status, "complete");
  assert.deepEqual(runner.get().items.map((item) => `${item.profileId}:${item.status}`), ["smol:done", "qwen:done", "coder:done", "phi:done"]);
});

test("with no GPU lanes, GPU models wait for the CPU lane", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn, { lanes: { cpu: 1, gpu: 0 } });
  runner.start({ models: MODELS });
  await finishProbes(spawn);
  const tunes = spawn.children.filter((child) => value(child.args, "--stages") !== "device");
  assert.equal(tunes.length, 1, "one tune at a time");
});

test("force goes only to a model's first run, so its tune resumes from the fresh probe", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS.slice(0, 1), force: true, tasks: ["code"] });
  await settle();
  assert.ok(spawn.children[0].args.includes("--force"));
  spawn.children[0].done = true;
  spawn.children[0].finish(0);
  await settle();
  assert.equal(spawn.children[1].args.includes("--force"), false);
  assert.equal(value(spawn.children[1].args, "--tasks"), "code");
  assert.equal(value(spawn.children[1].args, "--home"), "home");
});

test("only the chosen stages run; without the device stage there are no probes", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS.slice(0, 2), stages: ["sampling"] });
  await settle();
  assert.deepEqual(spawn.children.map((child) => value(child.args, "--stages")), ["sampling", "sampling"]);
});

test("a model that was already tuned is reported as skipped, and a failure is kept with its reason", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS.slice(0, 2), stages: ["quality"] });
  await settle();
  spawn.children[0].finish(0, [{ type: "complete", phase: "tune", skipped: true }]);
  spawn.children[1].stderr.write("That model is not installed\n");
  spawn.children[1].finish(1);
  await settle();
  const items = runner.get().items;
  assert.equal(items[0].status, "skipped");
  assert.equal(items[1].status, "failed");
  assert.match(items[1].error, /not installed/);
  assert.equal(runner.get().status, "complete");
});

test("cancelling stops every running tune and queues nothing more", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS, stages: ["quality"] });
  await settle();
  const running = spawn.children.length;
  runner.cancel();
  await settle();
  assert.ok(spawn.children.every((child) => child.killed));
  assert.equal(spawn.children.length, running);
  assert.equal(runner.get().status, "cancelled");
});

test("only one scheduled run at a time", () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS.slice(0, 1) });
  assert.throws(() => runner.start({ models: MODELS.slice(0, 1) }), (error) => error.code === "tune_in_progress");
});

test("a run of only some settings passes them to every tune", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS.slice(0, 1), stages: ["quality", "speed"], settings: ["contextSize", "threads"] });
  await settle();
  assert.equal(value(spawn.children[0].args, "--settings"), "contextSize,threads");
  assert.deepEqual(runner.get().settings, ["contextSize", "threads"]);
});

test("force can be set per model, so only out-of-date profiles start over", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: [{ ...MODELS[0], force: true }, MODELS[1]], stages: ["quality"] });
  await settle();
  const forced = spawn.children.map((child) => [value(child.args, "--model"), child.args.includes("--force")]);
  assert.deepEqual(forced, [["smol.gguf", true], ["qwen.gguf", false]]);
});
