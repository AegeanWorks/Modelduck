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

test("a continued run asks every tune to continue, not to start over", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS.slice(0, 1), stages: ["prompt"], continueRun: true });
  await settle();
  assert.ok(spawn.children[0].args.includes("--continue"));
  assert.equal(spawn.children[0].args.includes("--force"), false);
});

test("force can be set per model, so only out-of-date profiles start over", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: [{ ...MODELS[0], force: true }, MODELS[1]], stages: ["quality"] });
  await settle();
  const forced = spawn.children.map((child) => [value(child.args, "--model"), child.args.includes("--force")]);
  assert.deepEqual(forced, [["smol.gguf", true], ["qwen.gguf", false]]);
});

test("a running tune keeps a live summary of its answers, the setting it tries and what it decided", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  let changes = 0;
  const stop = runner.subscribe(() => { changes += 1; });
  runner.start({ models: MODELS.slice(0, 1), stages: ["prompt"] });
  await settle();
  const child = spawn.children[0];
  const line = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
  line({ type: "estimate", expectedAnswers: 480 });
  line({ type: "tune-candidate", stage: "prompt", task: "code", axis: "systemPrompt", rung: 12, patch: { systemPrompt: "A" }, rate: 50, latencyMs: 300, runs: 12, eta: "about 9 min left" });
  line({ type: "tune-candidate", stage: "prompt", task: "code", axis: "systemPrompt", rung: 12, patch: { systemPrompt: "B" }, rate: 75, latencyMs: 320, runs: 24, eta: "about 8 min left" });
  line({ type: "tune-candidate", stage: "prompt", task: "code", axis: "systemPrompt", rung: 48, patch: { systemPrompt: "B" }, rate: 80, latencyMs: 310, runs: 60, eta: "about 6 min left" });
  line({ type: "tune-sweep", stage: "prompt", task: "code", axis: "systemPrompt", winner: { systemPrompt: "B" }, changed: true, runs: 60 });
  line({ type: "tune-candidate", stage: "prompt", task: "code", axis: "reasoning", rung: 12, patch: { reasoning: "off" }, rate: 80, latencyMs: 300, runs: 72 });
  await settle();
  const live = runner.get().items[0].live;
  assert.equal(live.expectedAnswers, 480);
  assert.equal(live.answers, 72);
  assert.equal(live.eta, "about 6 min left", "the latest time left is kept until a newer one comes");
  assert.equal(live.axis.axis, "reasoning", "a new setting starts a new list of candidates");
  assert.deepEqual(live.axis.candidates.map((candidate) => candidate.patch.reasoning), ["off"]);
  assert.deepEqual(live.decisions.map((decision) => [decision.axis, decision.winner.systemPrompt, decision.changed]), [["systemPrompt", "B", true]]);
  assert.ok(changes >= 6, `subscribers heard every change (${changes})`);
  stop();
  const before = changes;
  line({ type: "tune-sweep", stage: "prompt", task: "code", axis: "reasoning", winner: { reasoning: "off" }, changed: false, runs: 80 });
  await settle();
  assert.equal(changes, before, "an unsubscribed listener hears nothing");
  child.finish(0);
  await settle();
});

test("a setting's candidate keeps only its latest round", async () => {
  const spawn = spawner();
  const runner = scheduler(spawn);
  runner.start({ models: MODELS.slice(0, 1), stages: ["sampling"] });
  await settle();
  const child = spawn.children[0];
  for (const [rung, rate] of [[12, 50], [24, 60]]) {
    child.stdout.write(`${JSON.stringify({ type: "tune-candidate", stage: "sampling", task: "chat", axis: "temperature", rung, patch: { temperature: 0 }, rate, runs: rung })}\n`);
  }
  await settle();
  const { candidates } = runner.get().items[0].live.axis;
  assert.equal(candidates.length, 1);
  assert.deepEqual([candidates[0].rung, candidates[0].rate], [24, 60]);
  child.finish(0);
  await settle();
});
