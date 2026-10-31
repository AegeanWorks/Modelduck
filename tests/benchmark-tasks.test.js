import assert from "node:assert/strict";
import test from "node:test";

import { PROMPTS } from "../benchmarks/suite.mjs";
import { CODE_GROUPS, TASKS, TASK_RUNGS, codeGroupOf, speedItems, suiteSummary, taskHoldout, taskPrompts, taskRungs, taskSubsetHash, tuneRungs, withDiscriminatingRungs } from "../benchmarks/tasks.mjs";

test("the four tasks cover every suite item exactly once", () => {
  assert.deepEqual(TASKS.map((task) => task.id), ["chat", "code", "math", "recall"]);
  const seen = new Map();
  for (const task of TASKS) {
    for (const prompt of taskPrompts(task.id)) {
      assert.equal(seen.has(prompt.id), false, `${prompt.id} is in ${seen.get(prompt.id)} and ${task.id}`);
      seen.set(prompt.id, task.id);
    }
  }
  assert.equal(seen.size, PROMPTS.length);
});

test("an unknown task is refused with a fix", () => {
  assert.throws(() => taskPrompts("poetry"), (error) =>
    error.code === "unknown_task" && /poetry/.test(error.why) && /chat, code, math, recall/.test(error.fix));
});

test("rungs grow, nest and stop at the task's tuning items", () => {
  for (const task of TASKS) {
    const all = taskPrompts(task.id).slice(0, taskPrompts(task.id).length - taskHoldout(task.id).length);
    const rungs = taskRungs(task.id);
    assert.ok(rungs.length >= 1 && rungs.length <= TASK_RUNGS.length);
    for (let index = 0; index < rungs.length; index += 1) {
      assert.equal(rungs[index].length, Math.min(TASK_RUNGS[index], all.length));
      if (index > 0) assert.deepEqual(rungs[index].slice(0, rungs[index - 1].length), rungs[index - 1]);
    }
  }
});

test("the first rung mixes categories instead of taking the first ones in suite order", () => {
  const chat = taskRungs("chat")[0];
  const buckets = new Set(taskPrompts("chat").filter((prompt) => chat.includes(prompt.id)).map((prompt) => prompt.category));
  assert.ok(buckets.size >= Math.min(chat.length, 4), `only ${[...buckets].join(", ")}`);
});

test("tune rungs give each task its rungs and the load stage every task's first two rungs", () => {
  const rungs = tuneRungs(["math", "recall"]);
  assert.deepEqual(Object.keys(rungs).sort(), ["holdout", "load", "loadByTask", "math", "recall", "speed"]);
  assert.deepEqual(rungs.loadByTask.math, taskRungs("math")[1], "each task's share of the last load level");
  assert.deepEqual(rungs.speed, [speedItems()]);
  assert.deepEqual(rungs.math, taskRungs("math"));
  assert.equal(rungs.load.length, 2);
  assert.deepEqual(rungs.load[0], [...taskRungs("math")[0], ...taskRungs("recall")[0]]);
  assert.deepEqual(rungs.load[1], [...taskRungs("math")[1], ...taskRungs("recall")[1]]);
});

test("the task subset hash is stable and changes with an item definition", () => {
  assert.match(taskSubsetHash(), /^[a-f0-9]{16}$/);
  assert.equal(taskSubsetHash(), taskSubsetHash());
  const changed = PROMPTS.map((prompt, index) => (index === 0 ? { ...prompt, prompt: `${prompt.prompt} ` } : prompt));
  assert.notEqual(taskSubsetHash(changed), taskSubsetHash());
});

test("coding categories map to the three tuning views", () => {
  assert.deepEqual(Object.keys(CODE_GROUPS), ["write", "fix", "repo"]);
  assert.equal(codeGroupOf("code"), "write");
  assert.equal(codeGroupOf("code-long"), "write");
  assert.equal(codeGroupOf("public-code"), "write");
  assert.equal(codeGroupOf("bugfix"), "fix");
  assert.equal(codeGroupOf("bugfix-long"), "fix");
  assert.equal(codeGroupOf("code-repo"), "repo");
  assert.equal(codeGroupOf("bugfix-repo"), "repo");
  assert.equal(codeGroupOf("knowledge"), null);
});

test("the speed workload is six fixed items covering every task", () => {
  const items = speedItems();
  assert.equal(items.length, 6);
  assert.equal(new Set(items).size, 6);
  for (const task of TASKS) assert.ok(items.some((id) => taskPrompts(task.id).some((prompt) => prompt.id === id)), `${task.id} missing`);
});

test("saturated items leave the search rungs but stay in the final set", () => {
  const rungs = tuneRungs(["math"]);
  const full = rungs.math.at(-1);
  const saturated = new Set(full.slice(0, 20));
  const { rungs: search, tunedOn } = withDiscriminatingRungs(rungs, saturated, ["math"]);
  const keep = full.slice(20);
  assert.equal(search.math.at(-1).length, keep.length);
  assert.ok(search.math.every((rung) => rung.every((id) => !saturated.has(id))));
  assert.deepEqual(search.final.math, full, "the final check still uses every tuning item");
  assert.deepEqual(tunedOn.math.ids, keep);
  assert.deepEqual(tunedOn.math.excluded, full.slice(0, 20));
  assert.equal(tunedOn.math.fellBack, false);
  assert.deepEqual(search.loadByTask.math, search.math[1]);
});

test("a task left with too few discriminating items keeps its whole search set", () => {
  const rungs = tuneRungs(["math"]);
  const full = rungs.math.at(-1);
  const nearlyAll = new Set(full.slice(0, full.length - 5));
  const { rungs: search, tunedOn } = withDiscriminatingRungs(rungs, nearlyAll, ["math"]);
  assert.deepEqual(search.math, rungs.math);
  assert.equal(tunedOn.math.fellBack, true);
  assert.deepEqual(tunedOn.math.ids, full);
  assert.deepEqual(tunedOn.math.excluded, []);
});

test("every task's last rung scores at least 36 items, enough to separate settings, with a quarter held back (ADR-054)", () => {
  for (const task of TASKS) {
    assert.ok(taskRungs(task.id).at(-1).length >= 36, `${task.id} ends at ${taskRungs(task.id).at(-1).length} items`);
  }
});

test("a quarter of each task is held back from tuning, across its categories, never in a rung", () => {
  for (const task of TASKS) {
    const all = taskPrompts(task.id);
    const held = taskHoldout(task.id);
    assert.ok(held.length >= all.length * 0.2 && held.length <= all.length * 0.3, `${task.id} holds back ${held.length} of ${all.length}`);
    const tuned = new Set(taskRungs(task.id).flat());
    assert.ok(held.every((id) => !tuned.has(id)), `${task.id} holds back an item it also tunes on`);
    const categories = new Set(all.filter((prompt) => held.includes(prompt.id)).map((prompt) => prompt.category));
    assert.ok(categories.size >= Math.min(3, new Set(all.map((prompt) => prompt.category)).size), `${task.id} holds back only ${[...categories].join(", ")}`);
  }
  assert.deepEqual(tuneRungs(["math"]).holdout.math, taskHoldout("math"));
});

test("the suite summary describes every task's question types, sources, checks and held-back items", () => {
  const summary = suiteSummary();
  assert.equal(summary.items, PROMPTS.length);
  assert.deepEqual(summary.tasks.map((task) => task.id), ["chat", "code", "math", "recall"]);
  const code = summary.tasks.find((task) => task.id === "code");
  assert.equal(code.items, taskPrompts("code").length);
  assert.equal(code.held, taskHoldout("code").length);
  assert.equal(code.tunedOn, taskRungs("code").at(-1).length);
  const repo = code.types.find((type) => type.category === "code-repo");
  assert.ok(repo.checks.includes("jsTests") && repo.checks.includes("oneOf"), "codebase items run code and name a function");
  assert.deepEqual(repo.sources, ["own"]);
  const humaneval = code.types.find((type) => type.category === "public-code");
  assert.ok(humaneval.sources.includes("HumanEval") && humaneval.sources.includes("MBPP"));
  assert.equal(code.types.reduce((sum, type) => sum + type.items, 0), code.items);
  assert.equal(code.types.reduce((sum, type) => sum + type.held, 0), code.held);
});
