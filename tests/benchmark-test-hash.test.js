import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_MATRIX } from "../benchmarks/matrix.mjs";
import { PROMPTS, SUITE_VERSION, SYSTEM_PROMPT } from "../benchmarks/suite.mjs";
import { benchmarkTestHash, modelIdentityChanges } from "../benchmarks/test-hash.mjs";

function hash(overrides = {}) {
  return benchmarkTestHash({
    suiteVersion: SUITE_VERSION,
    phase: "chat",
    prompts: PROMPTS,
    matrix: CHAT_MATRIX,
    systemPrompt: SYSTEM_PROMPT,
    ...overrides,
  });
}

test("the benchmark test hash is stable for the same definition", () => {
  assert.equal(hash(), hash());
  assert.match(hash(), /^[a-f0-9]{16}$/);
});

test("changing the global system prompt changes the test hash", () => {
  assert.notEqual(hash(), hash({ systemPrompt: "A different governing prompt." }));
});

test("changing a per-variant system prompt changes the test hash", () => {
  const matrix = CHAT_MATRIX.map((variant, index) =>
    index === 0 ? { ...variant, systemPrompt: "Answer like a pirate." } : variant,
  );
  assert.notEqual(hash(), hash({ matrix }));
});

test("changing promptIds changes the test hash", () => {
  const matrix = CHAT_MATRIX.map((variant, index) =>
    index === 0 ? { ...variant, promptIds: ["arithmetic"] } : variant,
  );
  assert.notEqual(hash(), hash({ matrix }));
});

test("changing a prompt's text or token limit changes the test hash", () => {
  const prompts = PROMPTS.map((prompt, index) =>
    index === 0 ? { ...prompt, prompt: "Say quack twice." } : prompt,
  );
  assert.notEqual(hash(), hash({ prompts }));
  const limits = PROMPTS.map((prompt, index) =>
    index === 0 ? { ...prompt, maxTokens: 32 } : prompt,
  );
  assert.notEqual(hash({ prompts }), hash({ prompts: limits }));
});

test("changing the suite version or phase changes the test hash", () => {
  assert.notEqual(hash(), hash({ suiteVersion: SUITE_VERSION + 1 }));
  assert.notEqual(hash(), hash({ phase: "model" }));
});

test("model identity changes are detected separately from the test hash", () => {
  const baseline = [
    { variantId: "qwen", size: 100, chatTemplateHash: "template-a" },
    { variantId: "llama", size: 200, chatTemplateHash: "template-b" },
  ];
  assert.deepEqual(modelIdentityChanges(baseline, baseline), []);

  const template = modelIdentityChanges(baseline, [
    { variantId: "qwen", size: 100, chatTemplateHash: "template-c" },
    { variantId: "llama", size: 200, chatTemplateHash: "template-b" },
  ]);
  assert.equal(template.length, 1);
  assert.equal(template[0].variantId, "qwen");
  assert.equal(template[0].currentTemplate, "template-c");

  const size = modelIdentityChanges(baseline, [
    { variantId: "qwen", size: 100, chatTemplateHash: "template-a" },
    { variantId: "llama", size: 201, chatTemplateHash: "template-b" },
  ]);
  assert.equal(size.length, 1);
  assert.equal(size[0].variantId, "llama");
});
