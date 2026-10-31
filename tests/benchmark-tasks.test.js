import assert from "node:assert/strict";
import test from "node:test";

import { PROMPTS } from "../benchmarks/suite.mjs";
import { TASKS, TASK_RUNGS, speedItems, taskHoldout, taskPrompts, taskRungs, taskSubsetHash, tuneRungs } from "../benchmarks/tasks.mjs";

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

test("the speed workload is six fixed items covering every task", () => {
  const items = speedItems();
  assert.equal(items.length, 6);
  assert.equal(new Set(items).size, 6);
  for (const task of TASKS) assert.ok(items.some((id) => taskPrompts(task.id).some((prompt) => prompt.id === id)), `${task.id} missing`);
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
