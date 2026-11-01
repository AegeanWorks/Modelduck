import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTimingLock, watchParent } from "../src/tune-lock.js";

async function lanes(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "modelduck-lanes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const alive = new Set([101, 202, 303]);
const lockFor = (dir, pid, extra = {}) => createTimingLock({ dir, pid, isAlive: (other) => alive.has(other), pollMs: 2, settleTimeoutMs: 2000, ...extra });
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

test("a timing stage waits until every other running tune has paused between answers", async (t) => {
  const dir = await lanes(t);
  const timer = lockFor(dir, 101);
  const other = lockFor(dir, 202);
  await timer.register();
  await other.register();

  let acquired = false;
  const acquiring = timer.acquire().then(() => { acquired = true; });
  await tick();
  // Wait for the timing lock to exist before the other tune asks; otherwise a
  // loaded machine can run its holder() check before acquire() has written it.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path.join(dir, "timing.lock"));
      break;
    } catch {
      await tick(2);
    }
  }
  assert.equal(acquired, false, "the other tune has not reached a pause point yet");

  let resumed = false;
  const pausing = other.pauseIfNeeded().then(() => { resumed = true; });
  await acquiring;
  assert.equal(acquired, true);
  await tick();
  assert.equal(resumed, false, "the other tune stays paused while the timing stage runs");

  await timer.release();
  await pausing;
  assert.equal(resumed, true);
});

test("without a timing stage, a tune never pauses", async (t) => {
  const dir = await lanes(t);
  const tune = lockFor(dir, 101);
  await tune.register();
  const started = Date.now();
  await tune.pauseIfNeeded();
  // Only a pause could take long here; 50 ms failed now and then on a loaded Windows disk.
  assert.ok(Date.now() - started < 1000);
});

test("a lock or registration left by a process that died is ignored", async (t) => {
  const dir = await lanes(t);
  await writeFile(path.join(dir, "timing.lock"), "999");
  await writeFile(path.join(dir, "active-888"), "");
  const tune = lockFor(dir, 101);
  await tune.register();
  await tune.acquire();
  await tune.release();
  await tune.pauseIfNeeded();
});

test("two timing stages take turns instead of measuring at the same time", async (t) => {
  const dir = await lanes(t);
  const tunes = [lockFor(dir, 101), lockFor(dir, 202)];
  await Promise.all(tunes.map((tune) => tune.register()));
  let holding = 0;
  let overlap = false;
  await Promise.all(tunes.map(async (tune) => {
    await tune.acquire();
    holding += 1;
    overlap ||= holding > 1;
    await tick(5);
    holding -= 1;
    await tune.release();
    await tune.unregister();
  }));
  assert.equal(overlap, false);
});

test("unregistering removes the process's files", async (t) => {
  const dir = await lanes(t);
  const tune = lockFor(dir, 303);
  await tune.register();
  await tune.unregister();
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes("303")), []);
});

test("a tune notices when the app that started it is gone", async () => {
  let parentAlive = true;
  let gone = 0;
  const watcher = watchParent({ ppid: 4242, isAlive: () => parentAlive, intervalMs: 2, onGone: () => { gone += 1; } });
  await tick(10);
  assert.equal(gone, 0);
  parentAlive = false;
  await tick(20);
  assert.equal(gone, 1, "called once");
  watcher.stop();
});

test("unregistering at process exit is synchronous", async (t) => {
  const dir = await lanes(t);
  const tune = lockFor(dir, 303);
  await tune.register();
  tune.unregisterSync();
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes("303")), []);
});

test("registering clears files left by tunes that died abruptly", async (t) => {
  const dir = await lanes(t);
  await writeFile(path.join(dir, "active-777"), "");
  await writeFile(path.join(dir, "paused-777"), "");
  await writeFile(path.join(dir, "timing.lock"), "777");
  await writeFile(path.join(dir, "active-202"), "");
  await lockFor(dir, 101).register();
  assert.deepEqual((await readdir(dir)).sort(), ["active-101", "active-202"], "only live tunes stay registered");
});
