import assert from "node:assert/strict";
import test from "node:test";

import { CODING_CATEGORIES } from "../benchmarks/recommend.mjs";
import { PROMPTS, SUITE_VERSION } from "../benchmarks/suite.mjs";
import { taskPrompts } from "../benchmarks/tasks.mjs";

const count = (category) => PROMPTS.filter((prompt) => prompt.category === category).length;

test("suite v9 adds our own coding and bug-fix questions, long ones included", () => {
  assert.equal(SUITE_VERSION, 9);
  assert.equal(PROMPTS.length, 174);
  assert.equal(count("code"), 30);
  assert.equal(count("code-long"), 6);
  assert.equal(count("bugfix"), 26);
  assert.equal(count("bugfix-long"), 6);
  assert.equal(new Set(PROMPTS.map((prompt) => prompt.id)).size, PROMPTS.length, "ids stay unique");
});

test("long items get room to answer, and every long bug fix shows a multi-line function", () => {
  for (const prompt of PROMPTS.filter((item) => item.category.endsWith("-long"))) {
    assert.equal(prompt.maxTokens, 1024, prompt.id);
  }
  for (const prompt of PROMPTS.filter((item) => item.category === "bugfix-long")) {
    assert.ok(prompt.buggyCode.split("\n").length >= 8, `${prompt.id} is a long function`);
    assert.ok(prompt.prompt.includes(prompt.buggyCode), `${prompt.id} shows its code`);
  }
});

test("the long categories count as coding everywhere", () => {
  const code = new Set(taskPrompts("code").map((prompt) => prompt.category));
  for (const category of ["code", "code-long", "bugfix", "bugfix-long", "public-code"]) {
    assert.ok(code.has(category), `code task lacks ${category}`);
    assert.ok(CODING_CATEGORIES.includes(category), `coding rate lacks ${category}`);
  }
});
