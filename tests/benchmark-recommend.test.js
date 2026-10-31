import assert from "node:assert/strict";
import test from "node:test";

import { recommend } from "../benchmarks/recommend.mjs";

function model(variantId, key, rate, tokensPerSecond, { total = 10, code = null, prompts = [], extra = {} } = {}) {
  const passed = Math.round((rate / 100) * total);
  return {
    variantId,
    key,
    label: `${variantId} · Q4_K_M`,
    fileName: `${key}.gguf`,
    kvCache: "f16",
    requestedContextSize: 2048,
    threads: 8,
    batchSize: 512,
    tokensPerSecond,
    firstTokenMs: 100,
    items: {
      passed,
      total,
      rate,
      ci95: { low: rate - 10, high: rate + 5 },
      byCategory: code === null ? {} : { code: { passed: code, total: 4 }, bugfix: { passed: 0, total: 2 } },
    },
    prompts,
    ...extra,
  };
}

test("recommendations pick best quality, coding, overall and fastest within the loss budget", () => {
  const result = {
    suiteVersion: 6,
    models: [
      model("big-f16", "big", 90, 10, { code: 2 }),
      model("coder-f16", "coder", 86, 22, { code: 4 }),
      model("small-f16", "small", 70, 50, { code: 1 }),
      model("tiny-f16", "tiny", 12, 140, { code: 0 }),
    ],
  };
  const advice = recommend(result, { maxLossPoints: 5 });
  const byKind = Object.fromEntries(advice.items.map((item) => [item.kind, item]));
  assert.equal(byKind.quality.variantId, "big-f16");
  assert.equal(byKind.coding.variantId, "coder-f16");
  assert.equal(byKind.speed.variantId, "coder-f16", "fastest within 5 pts of 90%");
  assert.equal(byKind.overall.variantId, "coder-f16");
  assert.equal(byKind.quality.settings.kvCache, "f16");
  assert.equal(byKind.quality.settings.contextSize, 2048);
  assert.ok(!advice.items.some((item) => item.variantId === "tiny-f16"), "a fast but poor model is never recommended");
});

test("speed tuning only suggests a smoke variant that kept the base model's answers", () => {
  const ok = { id: "a", passed: 1, total: 1 };
  const lost = { id: "a", passed: 0, total: 1 };
  const base = model("small-f16", "qwen2.5-0.5b-instruct-q4", 70, 50, {
    prompts: [ok, { id: "z", passed: 1, total: 1 }],
    extra: { catalogId: "qwen2.5-0.5b-instruct-q4" },
  });
  const fasterLost = model("small-batch128", "qwen2.5-0.5b-instruct", 0, 70, { total: 1, prompts: [lost], extra: { batchSize: 128, catalogId: "qwen2.5-0.5b-instruct-q4" } });
  const fasterKept = model("small-16threads", "qwen2.5-0.5b-instruct", 100, 60, { total: 1, prompts: [ok], extra: { threads: 16, catalogId: "qwen2.5-0.5b-instruct-q4" } });
  const advice = recommend({ models: [base, fasterLost, fasterKept] });
  assert.equal(advice.speedTuning.variantId, "small-16threads");
  assert.deepEqual(advice.speedTuning.settings, { threads: 16 });
});

test("no usable results means no advice", () => {
  assert.deepEqual(recommend({ models: [] }), { available: false, items: [] });
});

test("a result without a confidence interval still yields advice", () => {
  const only = model("small-f16", "small", 70, 50);
  delete only.items.ci95;
  const advice = recommend({ models: [only] });
  assert.equal(advice.available, true);
  assert.equal(advice.items[0].kind, "quality");
  assert.match(advice.items[0].why, /70%/);
});
