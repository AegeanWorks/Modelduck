import assert from "node:assert/strict";
import test from "node:test";

import { promptAxes } from "../benchmarks/tune-grid.mjs";
import { measurePresets, tune } from "../benchmarks/tune.mjs";

const ids = (prefix, count) => Array.from({ length: count }, (_value, index) => `${prefix}-${index}`);
const RUNGS = {
  load: [ids("mix", 4), ids("mix", 8)],
  speed: [ids("speed", 6)],
  math: [ids("math", 4), ids("math", 8)],
  recall: [ids("recall", 4), ids("recall", 6)],
};
const BASE = {
  contextSize: 4096, kvCache: "f16", flashAttention: "auto", threads: 16,
  temperature: 0.7, maxTokens: 256, minP: 0.05, systemPrompt: "Be precise.", reasoning: "off", promptRepeat: 1,
};
const AXES = {
  qualityAxes: [
    { name: "contextSize", patches: [2048, 4096, 8192].map((contextSize) => ({ contextSize })) },
    { name: "kvCache", patches: ["f16", "q8_0", "q4_0"].map((kvCache) => ({ kvCache })) },
  ],
  speedAxes: [
    { name: "flashAttention", patches: ["on", "off"].map((flashAttention) => ({ flashAttention })) },
    { name: "threads", patches: [1, 2, 4, 8].map((threads) => ({ threads })) },
  ],
  samplingAxes: () => [
    { name: "temperature", patches: [0, 0.2, 0.6].map((temperature) => ({ temperature })) },
    { name: "maxTokens", patches: [64, 128, 256, 512].map((maxTokens) => ({ maxTokens })) },
    { name: "minP", patches: [0, 0.1].map((minP) => ({ minP })), greedyNoop: true },
  ],
  promptAxes: [
    { name: "systemPrompt", patches: ["Be precise.", "Think from first principles.", "Embrace ambiguity."].map((systemPrompt) => ({ systemPrompt })), full: true },
    { name: "reasoning", patches: ["off", "auto"].map((reasoning) => ({ reasoning })) },
    { name: "promptRepeat", patches: [1, 2].map((promptRepeat) => ({ promptRepeat })) },
  ],
};

/** A model whose best settings at every stage are known. */
function syntheticModel() {
  const calls = [];
  const evaluate = async (settings, itemIds, seed) => {
    calls.push({ settings, itemIds, seed });
    const threads = Math.min(settings.threads, 8);
    const slowCores = settings.threads > 8 ? 200 : 0;
    return {
      memoryBytes: settings.contextSize * 1000,
      prompts: itemIds.map((id) => {
        let passed = true;
        if (id.startsWith("recall") || id === "mix-3") passed = settings.contextSize >= 8192;
        if (id === "mix-1" && settings.kvCache === "q4_0") passed = false;
        if (id.startsWith("math")) {
          const budget = settings.maxTokens ?? 512;
          passed = settings.temperature <= 0.2 && budget >= 128 && !(settings.temperature === 0.2 && seed === 7 && id === "math-0");
          if (id === "math-7") passed = passed && settings.systemPrompt === "Think from first principles.";
        }
        const extra = (settings.reasoning === "auto" ? 20 : 0) + (settings.promptRepeat === 2 ? 10 : 0);
        return {
          id,
          passed: passed ? 1 : 0,
          total: 1,
          ms: (settings.flashAttention === "off" ? 400 : 1000) / threads + slowCores + id.length,
          tokensPerSecond: threads * 5,
          outputTokens: (settings.maxTokens ?? 200) / 2 + extra,
          digest: `${id}:${settings.flashAttention === "off" ? "rounded" : "same"}`,
        };
      }),
    };
  };
  return { evaluate, calls };
}

function run(overrides = {}) {
  const model = syntheticModel();
  const result = tune({
    evaluate: model.evaluate,
    base: BASE,
    tasks: ["math", "recall"],
    rungs: RUNGS,
    hardware: { logicalCores: 12 },
    ...AXES,
    // These tests check selection mechanics on 4-8 items, so the significance rule is off (any gain counts); it has its own tests.
    options: { seeds: [42, 7, 1234], passes: 2, changeAlpha: Infinity },
    ...overrides,
  });
  return { model, result };
}

test("stage 1 picks the smallest context recall needs and keeps the KV cache that loses nothing", async () => {
  const { load, stages } = await run().result;
  assert.equal(load.settings.contextSize, 8192);
  assert.equal(load.settings.kvCache, "f16", "q8_0 was no faster and q4_0 lost an item");
  assert.equal(stages.quality, "done");
});

test("stage 2 picks the fastest threads, excludes settings that change answers, and offers a Light preset", async () => {
  const { load, speed, sweeps } = await run().result;
  assert.equal(load.settings.threads, 8);
  assert.notEqual(load.settings.flashAttention, "off", "flash off was faster but changed the answers");
  const flash = sweeps.find((sweep) => sweep.stage === "speed" && sweep.axis === "flashAttention");
  assert.ok(flash.rungs[0].candidates.find((candidate) => candidate.patch.flashAttention === "off").changedItems.length > 0);
  assert.equal(speed.fastest.threads, 8);
  assert.equal(speed.light.threads, 4, "the fastest at no more than half of 12 threads");
});

test("the tune never starts above three quarters of the logical threads", async () => {
  const { model, result } = run();
  await result;
  assert.ok(model.calls.every((call) => call.settings.threads <= 9));
});

test("stage 3 tunes sampling per task by quality, then answer length, and skips no-op axes when greedy", async () => {
  const { tasks, sweeps } = await run().result;
  assert.equal(tasks.math.settings.temperature, 0, "0.2 lost an item on one seed");
  assert.equal(tasks.math.settings.maxTokens, 128, "the shortest budget that keeps every item");
  const minP = sweeps.find((sweep) => sweep.task === "math" && sweep.axis === "minP");
  assert.match(minP.skippedReason, /temperature 0/);
  assert.equal(tasks.recall.settings.maxTokens, 64);
});

test("stage 4 scores every system prompt on the task's full set, then tunes reasoning and repetition", async () => {
  const { tasks, sweeps } = await run().result;
  assert.equal(tasks.math.settings.systemPrompt, "Think from first principles.");
  assert.equal(tasks.math.settings.reasoning, "off", "reasoning added tokens without quality");
  assert.equal(tasks.math.settings.promptRepeat, 1);
  assert.equal(tasks.math.stats.rate, 100);
  const prompts = sweeps.find((sweep) => sweep.task === "math" && sweep.axis === "systemPrompt");
  assert.equal(prompts.full, true);
  assert.equal(prompts.rungs.length, 1);
  assert.equal(prompts.rungs[0].size, 8);
  assert.equal(prompts.rungs[0].candidates.length, 3, "no prompt is eliminated early");
});

test("only the chosen stages run, and only tuned keys are stored, so the rest stay default", async () => {
  const { model, result } = run({ stages: ["quality"] });
  const done = await result;
  assert.deepEqual(done.load.settings, { contextSize: 8192, kvCache: "f16" });
  assert.equal(done.stages.speed, "pending");
  assert.deepEqual(done.tasks, {});
  assert.ok(model.calls.every((call) => call.itemIds[0].startsWith("mix")));
});

test("a resumed tune continues after the finished stages without measuring them again", async () => {
  const first = await run({ stages: ["quality"] }).result;
  const { model, result } = run({ resume: { ...first.progress, sweeps: first.sweeps } });
  const done = await result;
  assert.equal(model.calls.filter((call) => call.itemIds[0].startsWith("mix")).length, 0);
  assert.equal(done.load.settings.contextSize, 8192);
  assert.equal(done.stages.speed, "done");
  assert.equal(done.tasks.math.settings.systemPrompt, "Think from first principles.");
  assert.ok(done.sweeps.length > first.sweeps.length, "earlier sweeps are kept");
});

test("progress is reported after every axis, so a stopped tune keeps what it found", async () => {
  const states = [];
  await run({ onProgress: (state) => states.push(structuredClone(state)) }).result;
  const afterContext = states.find((state) => state.quality.done.includes("1:contextSize"));
  assert.equal(afterContext.quality.status, "partial");
  assert.deepEqual(afterContext.quality.settings, { contextSize: 8192, kvCache: "f16" });
  assert.equal(states.at(-1).prompt.recall.status, "done");
});

test("a run budget stops the tune with partial progress marked", async () => {
  const done = await run({ options: { seeds: [42, 7, 1234], passes: 2, maxRuns: 12, changeAlpha: Infinity } }).result;
  assert.equal(done.budgetExhausted, true);
  assert.ok(["partial", "pending"].includes(done.stages.quality));
  assert.ok(done.runs <= 12 + 8);
});

test("a rung only runs the items the previous rung did not", async () => {
  const { model, result } = run();
  await result;
  const seen = new Set();
  for (const call of model.calls) {
    for (const id of call.itemIds) {
      const key = `${JSON.stringify(call.settings)}|${call.seed}|${id}`; // aikit:allow-secret cache key
      assert.equal(seen.has(key), false, `re-ran ${key}`);
      seen.add(key);
    }
  }
});

test("statistics come with every candidate and every winner", async () => {
  const { sweeps, tasks } = await run().result;
  const candidate = sweeps.find((sweep) => sweep.stage === "quality").rungs[0].candidates[0];
  for (const key of ["rate", "ci95", "latencyMs", "latencySd", "outputTokens", "tokensPerSecond", "items", "seeds"]) {
    assert.ok(key in candidate, `candidate lacks ${key}`);
  }
  const temperature = sweeps.find((sweep) => sweep.task === "math" && sweep.axis === "temperature");
  assert.equal(typeof temperature.pValue, "number");
  assert.equal(temperature.speed.cost, "tokens");
  assert.deepEqual(Object.keys(tasks.math.stats.vsDefault).sort(), ["b", "c", "pValue", "rateDelta"]);
  assert.ok(tasks.math.stats.vsDefault.rateDelta > 0, "temperature 0.7 failed every math item");
});

test("impossible combinations are skipped and listed, never measured", async () => {
  const seen = [];
  const evaluate = async (settings, itemIds) => {
    seen.push({ ...settings });
    return { prompts: itemIds.map((id) => ({ id, passed: 1, total: 1, ms: 100, digest: id })) };
  };
  const { sweeps } = await tune({
    evaluate,
    base: { kvCache: "q8_0", flashAttention: "on", threads: 4 },
    tasks: [],
    rungs: { load: [ids("mix", 4)], speed: [ids("speed", 4)] },
    qualityAxes: [],
    speedAxes: [{ name: "flashAttention", patches: [{ flashAttention: "on" }, { flashAttention: "off" }] }],
  });
  assert.ok(seen.every((settings) => settings.flashAttention !== "off"));
  assert.deepEqual(sweeps[0].skipped, [{ flashAttention: "off" }]);
});

test("a candidate whose load failed never wins, even against a weak incumbent", async () => {
  const evaluate = async (settings, itemIds) => ({
    prompts: itemIds.map((id, index) => settings.kvCache === "q4_0"
      ? { id, passed: 0, total: 1, error: "load failed: unsupported KV type", ms: null }
      : { id, passed: index === 0 ? 1 : 0, total: 1, ms: 1000 }),
  });
  const { load, sweeps } = await tune({
    evaluate,
    base: { kvCache: "f16" },
    tasks: [],
    rungs: { load: [ids("mix", 8)] },
    qualityAxes: [{ name: "kvCache", patches: ["f16", "q4_0"].map((kvCache) => ({ kvCache })) }],
    speedAxes: [],
  });
  assert.equal(load.settings.kvCache, "f16", "12.5% beats a failed load within one item");
  const failed = sweeps[0].rungs[0].candidates.find((candidate) => candidate.patch.kvCache === "q4_0");
  assert.equal(failed.failed, true);
  assert.equal(failed.error, "load failed: unsupported KV type");
});

test("the one-item quality tolerance buys speed, never memory", async () => {
  const evaluate = async (settings, itemIds) => ({
    memoryBytes: settings.kvCache === "q8_0" ? 1 : 2,
    prompts: itemIds.map((id) => ({ id, passed: settings.kvCache === "q8_0" && id === "mix-0" ? 0 : 1, total: 1, ms: settings.kvCache === "q8_0" ? 100 : 1000 })),
  });
  const { load } = await tune({
    evaluate,
    base: { kvCache: "f16" },
    tasks: [],
    rungs: { load: [ids("mix", 8)] },
    qualityAxes: [{ name: "kvCache", patches: ["f16", "q8_0"].map((kvCache) => ({ kvCache })) }],
    speedAxes: [],
  });
  assert.equal(load.settings.kvCache, "q8_0", "10x faster for one lost item of 8");
});

test("a speed gap inside the measurement noise is a tie, so the incumbent stays", async () => {
  const swing = [1.4, 0.6, 1.4, 0.6, 1.3, 0.62];
  const evaluate = async (settings, itemIds) => ({
    prompts: itemIds.map((id, index) => ({ id, passed: 1, total: 1, digest: id, ms: settings.threads === 8 ? 950 * swing[index] : 1000 })),
  });
  const { load, sweeps } = await tune({
    evaluate,
    base: { threads: 4 },
    tasks: [],
    rungs: { load: [ids("mix", 2)], speed: [ids("speed", 6)] },
    hardware: { logicalCores: 16 },
    qualityAxes: [],
    speedAxes: [{ name: "threads", patches: [4, 8].map((threads) => ({ threads })) }],
  });
  assert.equal(load.settings.threads, 4);
  assert.equal(sweeps.find((sweep) => sweep.axis === "threads").speed.significant, false);
});

test("measuring saved presets scores each task's last rung with the tune's own rules", async () => {
  const model = syntheticModel();
  const measured = await measurePresets({
    evaluate: model.evaluate,
    load: { contextSize: 8192, threads: 8 },
    presets: { math: { temperature: 0, maxTokens: 128, systemPrompt: "Think from first principles." }, recall: { temperature: 0.7, maxTokens: 64 } },
    rungs: RUNGS,
  });
  assert.deepEqual(Object.keys(measured).sort(), ["math", "recall"]);
  assert.equal(measured.math.rate, 100);
  assert.equal(measured.math.items, 8);
  assert.equal(measured.recall.seeds, 3, "a non-zero temperature uses every seed");
});

/** Stage 0 alone, with a model whose device behaviour is given per backend/layers. */
async function probe(behaviour, { layers = 28 } = {}) {
  const calls = [];
  const evaluate = async (settings, itemIds) => {
    calls.push(settings);
    const key = settings.gpuBackend === "cpu" || !settings.gpuBackend ? "cpu" : `${settings.gpuBackend}:${settings.gpuLayers}`;
    const device = behaviour[key] ?? behaviour.cpu;
    return {
      prompts: itemIds.map((id, index) => device.error
        ? { id, passed: 0, total: 1, error: device.error, ms: null }
        : { id, passed: index < device.passed ? 1 : 0, total: 1, ms: device.ms * (1 + index / 20), tokensPerSecond: 1000 / device.ms, digest: id }),
    };
  };
  const result = await tune({
    evaluate,
    base: { threads: 4 },
    tasks: [],
    stages: ["device"],
    modelLayers: layers,
    rungs: { load: [ids("mix", 2)], speed: [ids("speed", 6)] },
    qualityAxes: [],
    speedAxes: [],
  });
  return { result, calls };
}

test("stage 0 moves a model to the GPU when it is faster and answers as well", async () => {
  const { result } = await probe({ cpu: { ms: 1000, passed: 5 }, "vulkan:max": { ms: 200, passed: 5 } });
  assert.deepEqual(result.load.settings, { gpuBackend: "vulkan", gpuLayers: "max" });
  assert.equal(result.stages.device, "done");
  assert.match(result.device.reason, /vulkan with max layers/);
  assert.equal(result.device.probe.find((entry) => entry.patch.gpuBackend === "vulkan").verdict, "chosen");
});

test("stage 0 keeps the CPU when the GPU answers fewer items correctly", async () => {
  const { result } = await probe({ cpu: { ms: 1000, passed: 6 }, "vulkan:max": { ms: 200, passed: 5 } });
  assert.deepEqual(result.load.settings, { gpuBackend: "cpu", gpuLayers: 0 });
  assert.match(result.device.probe[1].verdict, /answered 5 of 6 correctly vs 6 on the CPU/);
});

test("stage 0 tries half the layers only when all of them fail to load", async () => {
  const { result, calls } = await probe({ cpu: { ms: 1000, passed: 6 }, "vulkan:max": { error: "load failed: out of VRAM" }, "vulkan:14": { ms: 500, passed: 6 } });
  assert.deepEqual(result.load.settings, { gpuBackend: "vulkan", gpuLayers: 14 });
  assert.match(result.device.probe[1].verdict, /did not run: load failed: out of VRAM/);
  assert.ok(calls.some((settings) => settings.gpuLayers === 14));
});

test("stage 0 keeps the CPU when the GPU is only faster within the noise", async () => {
  const { result } = await probe({ cpu: { ms: 1000, passed: 6 }, "vulkan:max": { ms: 990, passed: 6 } });
  assert.equal(result.load.settings.gpuBackend, "cpu");
  assert.equal(result.device.probe[1].verdict, "not measurably faster than the CPU");
});

test("stage 0 compares throughput, so different answer lengths on the GPU cannot hide a real speedup", async () => {
  const lengths = [1, 8, 1, 6, 1, 9];
  const evaluate = async (settings, itemIds) => {
    const gpu = settings.gpuBackend === "vulkan";
    const speed = gpu ? 110 : 20;
    return {
      prompts: itemIds.map((id, index) => {
        const tokens = (gpu ? lengths[(index + 3) % 6] : lengths[index]) * 30;
        return { id, passed: 1, total: 1, ms: (tokens / speed) * 1000, tokensPerSecond: speed + index, digest: id };
      }),
    };
  };
  const result = await tune({
    evaluate, base: { threads: 4 }, tasks: [], stages: ["device"],
    rungs: { load: [ids("mix", 2)], speed: [ids("speed", 6)] }, qualityAxes: [], speedAxes: [],
  });
  assert.equal(result.load.settings.gpuBackend, "vulkan");
});

test("stage 0 says plainly when the CPU could not run the model at all", async () => {
  const { result } = await probe({ cpu: { error: "load failed: This model will not fit in memory" }, "vulkan:max": { ms: 300, passed: 6 } });
  assert.equal(result.load.settings.gpuBackend, "vulkan");
  assert.equal(result.device.probe[0].verdict, "did not run: load failed: This model will not fit in memory");
  assert.match(result.device.reason, /the CPU could not run it \(load failed: This model will not fit in memory\)/);
});

test("with parallel answers, the timing stages still answer one at a time", async () => {
  const { model, result } = run({ parallel: 4 });
  await result;
  const timed = model.calls.filter((call) => call.itemIds[0].startsWith("speed"));
  assert.ok(timed.length > 0 && timed.every((call) => call.settings.parallelism === 1));
  const quality = model.calls.filter((call) => call.itemIds[0].startsWith("mix"));
  assert.ok(quality.every((call) => call.settings.parallelism === undefined));
});

test("timing stages hold the timing lock, and only they do", async () => {
  const events = [];
  const timing = { acquire: async () => events.push("acquire"), release: async () => events.push("release") };
  const model = syntheticModel();
  const evaluate = async (settings, itemIds, seed) => {
    events.push(`${itemIds[0].split("-")[0]}${settings.timed ? ":timed" : ""}`);
    return model.evaluate(settings, itemIds, seed);
  };
  await tune({ evaluate, base: BASE, tasks: ["math"], rungs: RUNGS, hardware: { logicalCores: 12 }, ...AXES, timing });
  const held = (index) => events.slice(0, index).filter((event) => event === "acquire").length > events.slice(0, index).filter((event) => event === "release").length;
  assert.equal(events.filter((event) => event === "acquire").length, 2, "device and speed stages");
  events.forEach((event, index) => {
    if (event.endsWith(":timed")) assert.ok(held(index), `${event} ran without the lock`);
    if (event === "mix" || event === "math") assert.ok(!held(index), `${event} ran while holding the lock`);
  });
});

test("only chosen settings re-run, on top of everything else's current best", async () => {
  const first = await run().result;
  const { model, result } = run({ resume: { ...first.progress, sweeps: first.sweeps }, only: ["contextSize"] });
  const done = await result;
  const swept = done.sweeps.slice(first.sweeps.length).map((sweep) => sweep.axis);
  assert.deepEqual([...new Set(swept)], ["contextSize"]);
  assert.ok(model.calls.every((call) => call.itemIds[0].startsWith("mix")));
  assert.ok(model.calls.every((call) => call.settings.kvCache === first.load.settings.kvCache), "the other quality setting stays at its tuned value");
  assert.equal(done.stages.quality, "done", "a finished stage stays finished");
  assert.deepEqual(done.tasks.math.settings, first.tasks.math.settings);
});

test("a setting chosen on its own stores only what was measured", async () => {
  const { model, result } = run({ only: ["threads", "temperature"] });
  const done = await result;
  assert.deepEqual(Object.keys(done.load.settings), ["threads"], "flash attention was not measured, so it is not stored");
  assert.equal(done.stages.speed, "partial");
  assert.equal(done.stages.quality, "pending");
  assert.equal(done.stages.device, "pending");
  assert.deepEqual(Object.keys(done.tasks.math.settings), ["temperature"]);
  assert.equal(done.stages.sampling.math, "partial");
  assert.ok(!model.calls.some((call) => call.itemIds[0].startsWith("mix")), "no quality questions");
});

test("choosing the device re-probes it even when it was probed before", async () => {
  const first = await run({ stages: ["device"] }).result;
  const { model, result } = run({ resume: { ...first.progress, sweeps: first.sweeps }, only: ["device"] });
  const done = await result;
  assert.ok(model.calls.length > 0);
  assert.equal(done.stages.device, "done");
  assert.equal(done.stages.quality, "pending");
});

/** A prompt-only tune on 20 items where the suite prompt gets half right and each rival a known number more. */
async function promptTune(rivals) {
  const gains = { "Be precise.": 0, ...rivals };
  const items = ids("math", 20);
  return tune({
    evaluate: async (settings, itemIds) => ({
      memoryBytes: 1,
      prompts: itemIds.map((id) => {
        const index = Number(id.split("-")[1]);
        return { id, passed: index < 10 + gains[settings.systemPrompt] ? 1 : 0, total: 1, ms: 10, tokensPerSecond: 10, outputTokens: 10, digest: id };
      }),
    }),
    base: { ...BASE, temperature: 0 },
    tasks: ["math"],
    stages: ["prompt"],
    rungs: { ...RUNGS, math: [items] },
    hardware: { logicalCores: 12 },
    ...AXES,
    promptAxes: [{ name: "systemPrompt", patches: Object.keys(gains).map((systemPrompt) => ({ systemPrompt })), full: true }],
    options: { seeds: [42], passes: 1 },
  });
}

test("a challenger one lucky item ahead does not replace the current setting", async () => {
  const { tasks, sweeps } = await promptTune({ "Lucky guess.": 1, "Also lucky.": 1 });
  assert.equal(tasks.math.settings.systemPrompt, "Be precise.");
  const sweep = sweeps.find((entry) => entry.axis === "systemPrompt");
  assert.equal(sweep.changed, false);
  assert.match(sweep.kept, /Lucky guess\.|Also lucky\./, "the sweep says which challenger was best");
  assert.match(sweep.kept, /p=1/);
  assert.match(sweep.kept, /0\.1\b/, "the bar is corrected for two challengers (0.2 / 2)");
});

test("a challenger with a clear paired gain replaces the current setting", async () => {
  const { tasks, sweeps } = await promptTune({ "Lucky guess.": 1, "Work it out.": 10 });
  assert.equal(tasks.math.settings.systemPrompt, "Work it out.");
  const sweep = sweeps.find((entry) => entry.axis === "systemPrompt");
  assert.equal(sweep.changed, true);
  assert.equal(sweep.kept, undefined);
  assert.ok(sweep.pValue <= 0.1);
});

test("when nothing can load, the tune stops with the reason instead of choosing among failures", async () => {
  const calls = [];
  const evaluate = async (settings, itemIds) => {
    calls.push(settings);
    return { prompts: itemIds.map((id) => ({ id, passed: 0, total: 1, error: "load failed: no GPU binary", ms: null })) };
  };
  const result = await tune({
    evaluate,
    base: BASE,
    tasks: ["math"],
    rungs: RUNGS,
    hardware: { logicalCores: 12 },
    ...AXES,
    options: { seeds: [42], passes: 2 },
  });
  assert.match(result.stopped, /could not load.*no GPU binary/i);
  assert.equal(result.stages.quality, "pending", "nothing is marked tuned");
  assert.equal(result.tasks.math, undefined, "no preset is made from failed answers");
  // The first rung of the first axis (with the baseline measurement), then nothing: no other axis, no later stage.
  assert.ok(calls.every((call) => call.kvCache === BASE.kvCache && call.temperature === 0), "it stops before any other axis");
  assert.ok(calls.length <= AXES.qualityAxes[0].patches.length + 2);
});

test("with a memory budget, the context size comes from free memory, not from short questions", async () => {
  const asked = [];
  const { model, result } = run({
    qualityAxes: [{ ...AXES.qualityAxes[0], budget: true }, AXES.qualityAxes[1]],
    contextBudget: async (settings, sizes) => {
      asked.push({ kvCache: settings.kvCache, sizes });
      return { contextSize: settings.kvCache === "q8_0" ? 8192 : 4096, reason: "4096 is the largest listed context that fits comfortably" };
    },
  });
  const { load, sweeps } = await result;
  const context = sweeps.find((sweep) => sweep.axis === "contextSize");
  assert.equal(context.budget, true);
  assert.match(context.reason, /fits comfortably/);
  assert.deepEqual(context.rungs, [], "no context size was measured on questions");
  assert.deepEqual(asked[0].sizes, [2048, 4096, 8192]);
  assert.equal(load.settings.contextSize, 4096);
  assert.ok(sweeps.some((sweep) => sweep.axis === "kvCache" && sweep.rungs.length > 0), "the KV cache is still measured");
  const contexts = new Set(model.calls.filter((call) => call.itemIds.some((id) => id.startsWith("mix"))).map((call) => call.settings.contextSize));
  assert.deepEqual([...contexts], [4096], "quality questions only ran at the budgeted size");
});

test("reasoning on is tried with room to answer, and the preset keeps that room", async () => {
  const items = ids("math", 20);
  const seen = [];
  const { tasks } = await tune({
    evaluate: async (settings, itemIds) => {
      seen.push({ reasoning: settings.reasoning, maxTokens: settings.maxTokens });
      // Thinking first helps only when the answer is not cut off.
      const thinks = settings.reasoning === "deep" && settings.maxTokens >= 1024;
      return { prompts: itemIds.map((id, index) => ({ id, passed: thinks || index < 10 ? 1 : 0, total: 1, ms: 10, outputTokens: 10, digest: id })) };
    },
    base: { ...BASE, temperature: 0, maxTokens: 256 },
    tasks: ["math"],
    stages: ["prompt"],
    rungs: { ...RUNGS, math: [items] },
    hardware: { logicalCores: 12 },
    ...AXES,
    promptAxes: promptAxes({ systemPrompt: ["Be precise."], reasoning: ["off", "deep"], promptRepeat: [1] }),
    options: { seeds: [42], passes: 1 },
  });
  assert.ok(seen.some((call) => call.reasoning === "deep" && call.maxTokens === 1024), "deep was tried with 1024 tokens");
  assert.equal(tasks.math.settings.reasoning, "deep");
  assert.equal(tasks.math.settings.maxTokens, 1024, "the preset keeps the room deep needs");
});

test("system prompts are screened on a quarter of the items, and only clear losers stop early", async () => {
  const items = ids("math", 48);
  const asked = new Map();
  // How many of the first items each prompt gets right; the suite prompt gets the first 30.
  const solved = { "Be precise.": 30, "Close behind.": 28, "Clearly worse.": 4 };
  const { sweeps } = await tune({
    evaluate: async (settings, itemIds) => {
      asked.set(settings.systemPrompt, [...(asked.get(settings.systemPrompt) ?? []), ...itemIds]);
      return { prompts: itemIds.map((id) => ({ id, passed: Number(id.split("-")[1]) < solved[settings.systemPrompt] ? 1 : 0, total: 1, ms: 10, outputTokens: 10, digest: id })) };
    },
    base: { ...BASE, temperature: 0 },
    tasks: ["math"],
    stages: ["prompt"],
    rungs: { ...RUNGS, math: [items] },
    hardware: { logicalCores: 12 },
    ...AXES,
    promptAxes: [{ name: "systemPrompt", patches: Object.keys(solved).map((systemPrompt) => ({ systemPrompt })), full: true }],
    options: { seeds: [42], passes: 1 },
  });
  const sweep = sweeps.find((entry) => entry.axis === "systemPrompt");
  assert.deepEqual(sweep.rungs.map((rung) => rung.size), [12, 48], "a 12-item screen, then the full set");
  assert.deepEqual(sweep.dropped.map((entry) => entry.patch.systemPrompt), ["Clearly worse."]);
  assert.equal(sweep.dropped[0].behind, 8);
  assert.equal(new Set(asked.get("Clearly worse.")).size, 12, "a dropped prompt answers only the screen");
  assert.equal(new Set(asked.get("Close behind.")).size, 48, "a close one is measured on everything");
  assert.equal(sweep.winner.systemPrompt, "Be precise.");
});
