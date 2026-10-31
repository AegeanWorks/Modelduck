import assert from "node:assert/strict";
import test from "node:test";

import { JitManager } from "../src/jit.js";

test("a just-in-time load uses the model's tuned load settings", async () => {
  const loads = [];
  const entry = { id: "m1", name: "Tuned", fileName: "tuned.gguf" };
  const jit = new JitManager({
    engine: { loadedId: null, load: async (options) => loads.push(options), unload: async () => {} },
    registry: { listPublic: () => [entry], findById: (id) => (id === "m1" ? entry : null) },
    settings: { value: { contextSize: 2048, threads: 2, temperature: 0.7 } },
    serverSettings: { value: { jitLoading: true, jitModelLoading: true, justInTimeModelLoading: true, onlyKeepLastJitLoadedModel: true, autoUnloadMinutes: 0 } },
    tuned: { resolve: async (modelId) => (modelId === "m1" ? { settings: { contextSize: 8192, threads: 6 } } : null) },
    logger: { info() {}, warn() {} },
  });
  await jit.ensure("tuned.gguf");
  jit.dispose();
  assert.equal(loads[0].contextSize, 8192);
  assert.equal(loads[0].threads, 6);
  assert.equal(loads[0].temperature, 0.7, "untuned keys keep the user's value");
});
