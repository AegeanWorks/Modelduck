import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTextCheck, extractCode } from "../benchmarks/suite.mjs";

const passes = (check, reply) => evaluateTextCheck(check, reply).passed;

test("a correct answer passes however it is worded or formatted", () => {
  const exact = { type: "exact", value: "3546" };
  for (const reply of ["3546", "3546.", "**3546**", "`3546`", "The PIN is 3546.", "PIN: 3546", "Answer: 3546", "3546\n\nIt is on the first line."]) {
    assert.ok(passes(exact, reply), reply);
  }
  const oneOf = { type: "oneOf", values: ["c7", "room c7"] };
  for (const reply of ["C7", "Room C7.", "The meeting is in room C7.", "**C7**"]) assert.ok(passes(oneOf, reply), reply);
  const choice = { type: "choice", value: "B" };
  for (const reply of ["B", "B) Paris", "(B)", "**B**", "Answer: B", "The answer is B.", "Option B", "The correct answer is (B) Paris."]) {
    assert.ok(passes(choice, reply), reply);
  }
  const number = { type: "number", value: 15 };
  for (const reply of ["Answer: 15", "15 games won.", "Answer: 15\n\nCheck: 15 + 7 = 22", "Answer: $15.00", "8 + 7 = 15\nAnswer: 15"]) {
    assert.ok(passes(number, reply), reply);
  }
});

test("a wrong, hedged or missing answer still fails", () => {
  const exact = { type: "exact", value: "3546" };
  for (const reply of ["3547", "Is it 3546 or 4596?", "PIN: 4596", "The PIN is not 3546.", "35466", ""]) assert.equal(passes(exact, reply), false, reply);
  const choice = { type: "choice", value: "B" };
  for (const reply of ["A", "Answer: A", "The answer is C.", "B or C", "As we know, the answer is D."]) assert.equal(passes(choice, reply), false, reply);
  const number = { type: "number", value: 15 };
  for (const reply of ["Answer: 16", "15 or 16", "Answer: 150"]) assert.equal(passes(number, reply), false, reply);
});

test("a reply with nothing readable is marked as a format problem, a readable wrong one is not", () => {
  assert.equal(evaluateTextCheck({ type: "choice", value: "B" }, "I am not sure.").unreadable, true);
  assert.equal(evaluateTextCheck({ type: "number", value: 15 }, "fifteen").unreadable, true);
  assert.equal(evaluateTextCheck({ type: "choice", value: "B" }, "Answer: A").unreadable, false);
  assert.equal(evaluateTextCheck({ type: "number", value: 15 }, "Answer: 16").unreadable, false);
});

test("the code tested is the block that defines the function, not a usage example before it", () => {
  const reply = "Here is how to call it:\n```js\nconsole.log(clamp(5, 0, 10));\n```\nAnd the function:\n```js\nfunction clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }\n```";
  assert.match(extractCode(reply, "clamp"), /function clamp/);
  assert.match(extractCode("```js\nconst clamp = (x, a, b) => Math.min(b, Math.max(a, x));\n```", "clamp"), /const clamp/);
  assert.match(extractCode("```js\nfunction other() {}\n```", "clamp"), /function other/, "with no defining block, the first block is used as before");
});
