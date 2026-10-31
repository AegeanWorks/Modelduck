import assert from "node:assert/strict";
import test from "node:test";

import { estimateLoad, fitVerdict, kvBytesPerToken } from "../src/memory-fit.js";

const GIB = 1024 ** 3;
const QWEN_1_5B = { layers: 28, kvHeads: 2, headDim: 128 };
const LLAMA_3B = { layers: 28, kvHeads: 8, headDim: 128 };

test("KV bytes per token follow the GGUF attention shape and cache type", () => {
  assert.equal(kvBytesPerToken(QWEN_1_5B, "f16"), 28_672);
  assert.equal(kvBytesPerToken(LLAMA_3B, "f16"), 114_688);
  assert.ok(kvBytesPerToken(LLAMA_3B, "q8_0") < kvBytesPerToken(LLAMA_3B, "f16") * 0.55);
  assert.equal(kvBytesPerToken(null, "f16"), null);
});

test("the estimate adds weights, KV at the chosen context and a runtime reserve", () => {
  const estimate = estimateLoad({ modelBytes: 1.83 * GIB, shape: LLAMA_3B, contextSize: 8192, kvCache: "f16" });
  assert.equal(estimate.kv, 114_688 * 8192);
  assert.ok(estimate.total > estimate.weights + estimate.kv);
  assert.equal(estimateLoad({ modelBytes: GIB, shape: null, contextSize: 4096, kvCache: "f16" }).kv, null);
});

test("verdicts are comfortable, tight or will not fit, with the largest safe context", () => {
  const load = (contextSize) => estimateLoad({ modelBytes: 1.83 * GIB, shape: LLAMA_3B, contextSize, kvCache: "f16" });
  const roomy = fitVerdict({ estimate: load(4096), availableBytes: 8 * GIB, shape: LLAMA_3B, modelBytes: 1.83 * GIB, kvCache: "f16" });
  assert.equal(roomy.verdict, "comfortable");

  const tight = fitVerdict({ estimate: load(4096), availableBytes: 3.6 * GIB, shape: LLAMA_3B, modelBytes: 1.83 * GIB, kvCache: "f16" });
  assert.equal(tight.verdict, "tight");

  const tooBig = fitVerdict({ estimate: load(32768), availableBytes: 4 * GIB, shape: LLAMA_3B, modelBytes: 1.83 * GIB, kvCache: "f16" });
  assert.equal(tooBig.verdict, "will_not_fit");
  assert.ok(tooBig.largestSafeContext >= 512 && tooBig.largestSafeContext < 32768);
  const safe = load(tooBig.largestSafeContext);
  assert.ok(safe.total <= 4 * GIB * 0.75);

  const unknown = fitVerdict({ estimate: estimateLoad({ modelBytes: GIB, shape: null, contextSize: 4096, kvCache: "f16" }), availableBytes: 8 * GIB });
  assert.equal(unknown.verdict, "unknown");
});
