import fs from "node:fs";
import path from "node:path";

import { AppError } from "./errors.js";
import { ensureDirectory, readJsonWithQuarantine, writeJsonAtomic } from "./fs-atomic.js";

/**
 * A record of every tune run (ADR-050): `<id>.json` holds what was asked, the
 * machine and suite, the outcome, the run's decisions and the resulting presets,
 * rewritten atomically as the run goes; `<id>.answers.jsonl` holds every answer,
 * appended as it comes, so a stopped run keeps everything it measured. Nothing
 * is deleted automatically.
 */

const RUN_SCHEMA = 1;
const ID_PATTERN = /^[0-9A-Za-z-]+$/;

const quiet = { warn() {} };

function checkedId(id) {
  if (typeof id === "string" && ID_PATTERN.test(id)) return id;
  throw new AppError("Unknown tune run", {
    code: "tune_run_bad_id",
    status: 400,
    why: `"${id}" is not a tune run id.`,
    fix: "Pick a run from the list of tune runs.",
  });
}

const summaryFile = (dir, id) => path.join(dir, `${checkedId(id)}.json`);

/** Where a run's answers are kept, one JSON object per line. */
export function answersFile(dir, id) {
  return path.join(dir, `${checkedId(id)}.answers.jsonl`);
}

function isAliveDefault(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** Start recording a run; the recorder keeps the summary and appends answers as they come. */
export async function startRun(dir, { profileId, model, request, fingerprint = null, expectedAnswers = null, now = new Date(), pid = process.pid }) {
  await ensureDirectory(dir);
  const id = `${now.toISOString().replace(/[:.]/g, "-")}-${pid}`;
  let record = {
    schema: RUN_SCHEMA,
    id,
    pid,
    profileId,
    model,
    request,
    fingerprint,
    expectedAnswers,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    finishedAt: null,
    durationMs: null,
    outcome: "running",
    error: null,
    answers: 0,
  };
  const save = () => writeJsonAtomic(summaryFile(dir, id), record);
  await save();
  // Writes go one after another, so a slow disk never reorders a summary.
  let queue = Promise.resolve();
  const later = (work) => (queue = queue.then(work, work));
  return {
    id,
    answers: (rows) => later(() => (rows.length ? fs.promises.appendFile(answersFile(dir, id), rows.map((row) => `${JSON.stringify(row)}\n`).join("")) : undefined)),
    update: (patch) => later(() => {
      record = { ...record, ...patch, updatedAt: new Date().toISOString() };
      return save();
    }),
    finish: ({ outcome, error = null, now: ended = new Date(), ...patch }) => later(() => {
      record = { ...record, ...patch, outcome, error, finishedAt: ended.toISOString(), updatedAt: ended.toISOString(), durationMs: ended - new Date(record.startedAt) };
      return save();
    }),
  };
}

/** A saved run with all its details, or null when there is none. */
export async function loadRun(dir, id) {
  return readJsonWithQuarantine(summaryFile(dir, id), null, { logger: quiet });
}

/** Every saved run without its details, newest first; one left running by a process that has died is "interrupted". */
export async function listRuns(dir, { isAlive = isAliveDefault } = {}) {
  const names = await fs.promises.readdir(dir).catch(() => []);
  const runs = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const record = await readJsonWithQuarantine(path.join(dir, name), null, { logger: quiet });
    if (record?.schema !== RUN_SCHEMA) continue;
    const { sweeps: _sweeps, result: _result, ...summary } = record;
    if (summary.outcome === "running" && !isAlive(summary.pid)) summary.outcome = "interrupted";
    runs.push(summary);
  }
  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
