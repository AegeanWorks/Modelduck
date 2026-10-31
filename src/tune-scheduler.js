import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { AppError } from "./errors.js";
import { readSteps } from "./tune-steps.js";

const SCRIPT = fileURLToPath(new URL("../benchmarks/tune-run.mjs", import.meta.url));
const ALL_STAGES = Object.freeze(["device", "quality", "speed", "sampling", "prompt"]);
const LOG_LINES = 12;

/**
 * Tunes several models side by side (ADR-033). Device probes run one at a
 * time first, since they time answers; then each model's remaining stages run
 * in its lane — CPU or GPU, from its probe — with the lane counts from the
 * user's tune settings. Speed stages inside those tunes take a timing lock so
 * the others pause (src/tune-lock.js).
 */
export class TuneScheduler {
  #homeDir;
  #modelsDir;
  #scriptPath;
  #spawn;
  #readLanes;
  #readLane;
  #logger;
  #job = null;
  #children = new Set();
  #listeners = new Set();

  constructor({ homeDir, modelsDir, profilesDir = null, tuneStepsFile = null, scriptPath = SCRIPT, spawnImpl = spawn, readLanes = null, readLane = null, logger = console }) {
    this.#homeDir = homeDir;
    this.#modelsDir = modelsDir;
    this.#scriptPath = scriptPath;
    this.#spawn = spawnImpl;
    this.#readLanes = readLanes ?? (async () => (await readSteps(tuneStepsFile)).steps.lanes);
    this.#readLane = readLane ?? ((model) => laneFromProfile(profilesDir, model));
    this.#logger = logger;
  }

  /** Call `listener` after every change to the job; returns the function that stops it (ADR-055). */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed() {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#logger.warn?.(`[modelduck] Tune listener failed: ${error?.message ?? error}`);
      }
    }
  }

  get() {
    if (!this.#job) return null;
    return { ...this.#job, items: this.#job.items.map((item) => ({ ...item, log: [...item.log] })) };
  }

  /** Start tuning `models` ([{ id, fileName, profileId, name }]); resolves immediately with the job. */
  start({ models, tasks = null, stages = null, settings = null, force = false, continueRun = false }) {
    if (this.#job?.status === "running") {
      throw new AppError("A tune is already running", {
        code: "tune_in_progress",
        status: 409,
        why: "ModelDuck schedules one set of tunes at a time so lanes and timing stay fair.",
        fix: "Wait for it to finish, or cancel it first.",
      });
    }
    const wanted = (stages?.length ? stages : ALL_STAGES).filter((stage) => ALL_STAGES.includes(stage));
    this.#job = {
      id: randomUUID(),
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stages: wanted,
      tasks: tasks?.length ? [...tasks] : null,
      settings: settings?.length ? [...settings] : null,
      force: Boolean(force),
      continueRun: Boolean(continueRun),
      items: models.map((model) => ({
        profileId: model.profileId, name: model.name ?? model.profileId, fileName: model.fileName,
        lane: null, phase: null, status: "queued", progress: null, exitCode: null, error: null, log: [], live: emptyLive(),
      })),
    };
    const job = this.#job;
    this.#run(job, models).catch((error) => {
      this.#logger.warn?.(`[modelduck] Tune scheduler failed: ${error?.message ?? error}`);
      this.#finish(job, "failed");
    });
    this.#changed();
    return this.get();
  }

  cancel() {
    const job = this.#job;
    if (!job || job.status !== "running") {
      throw new AppError("No tune is running", { code: "tune_not_running", status: 409, why: "There is nothing to stop.", fix: "Start a tune first." });
    }
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    for (const item of job.items) if (item.status === "queued" || item.status === "running") item.status = "cancelled";
    for (const child of this.#children) child.kill();
    this.#changed();
    return this.get();
  }

  dispose() {
    for (const child of this.#children) child.kill();
  }

  async #run(job, models) {
    const probe = job.stages.includes("device");
    const rest = job.stages.filter((stage) => stage !== "device");
    const forced = new Set();
    const forceOnce = (model) => {
      // Force applies to every model or only to those that ask for it (a stale profile).
      if (!(job.force || model.force) || forced.has(model.profileId)) return false;
      forced.add(model.profileId);
      return true;
    };
    if (probe) {
      for (const [index, model] of models.entries()) {
        if (job.status !== "running") return;
        await this.#runChild(job, job.items[index], model, ["device"], "device", forceOnce(model), rest.length > 0);
      }
    }
    if (rest.length && job.status === "running") {
      const lanes = await this.#readLanes();
      const queues = { cpu: [], gpu: [] };
      for (const [index, model] of models.entries()) {
        const item = job.items[index];
        if (item.status === "failed" || item.status === "cancelled") continue;
        item.lane = (await this.#readLane(model)) === "gpu" && lanes.gpu > 0 ? "gpu" : "cpu";
        queues[item.lane].push({ model, item });
      }
      const lane = async (queue) => {
        while (queue.length && job.status === "running") {
          const { model, item } = queue.shift();
          await this.#runChild(job, item, model, rest, "tune", forceOnce(model), false);
        }
      };
      const workers = [];
      for (let count = 0; count < lanes.cpu; count += 1) workers.push(lane(queues.cpu));
      for (let count = 0; count < lanes.gpu; count += 1) workers.push(lane(queues.gpu));
      await Promise.all(workers);
    }
    this.#finish(job, job.status === "running" ? "complete" : job.status);
  }

  #runChild(job, item, model, stages, phase, force, more) {
    return new Promise((resolve) => {
      const args = [this.#scriptPath, "--events", "--model", model.fileName, "--stages", stages.join(","), "--home", this.#homeDir];
      if (this.#modelsDir) args.push("--models-dir", this.#modelsDir);
      if (job.tasks) args.push("--tasks", job.tasks.join(","));
      if (job.settings) args.push("--settings", job.settings.join(","));
      if (force) args.push("--force");
      if (job.continueRun) args.push("--continue");
      Object.assign(item, { phase, status: "running", progress: { type: "starting", stage: stages[0] }, exitCode: null });
      this.#changed();
      let child;
      try {
        child = this.#spawn(process.execPath, args, { cwd: path.dirname(this.#scriptPath), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        Object.assign(item, { status: "failed", error: error.message });
        resolve();
        return;
      }
      this.#children.add(child);
      let skipped = false;
      const stdout = createInterface({ input: child.stdout });
      stdout.on("line", (line) => {
        const event = parseEvent(line);
        if (!event) return pushLog(item, line);
        item.progress = event;
        followLive(item.live, event);
        if (event.type === "complete" && event.skipped) skipped = true;
        this.#changed();
      });
      createInterface({ input: child.stderr }).on("line", (line) => pushLog(item, line));
      let closed = false;
      child.on("close", (code) => {
        if (closed) return;
        closed = true;
        this.#children.delete(child);
        item.exitCode = code;
        if (job.status === "cancelled") item.status = "cancelled";
        else if (code === 0) item.status = more ? "queued" : skipped ? "skipped" : "done";
        else Object.assign(item, { status: "failed", error: item.log.at(-1) ?? `The tune exited with code ${code}.` });
        this.#changed();
        resolve();
      });
    });
  }

  #finish(job, status) {
    if (job.finishedAt) return;
    job.status = status;
    job.finishedAt = new Date().toISOString();
    this.#changed();
  }
}

const KEPT_DECISIONS = 30;

const emptyLive = () => ({ expectedAnswers: null, answers: 0, eta: null, axis: null, decisions: [] });

/**
 * What the Bench panel shows while a tune runs: answers so far against the expected
 * count, the time left, the setting being tried with each value's latest round, and
 * the decisions made so far (ADR-055).
 */
function followLive(live, event) {
  if (Number.isFinite(event.runs)) live.answers = event.runs;
  if (event.eta) live.eta = event.eta;
  if (event.type === "estimate" && Number.isFinite(event.expectedAnswers)) live.expectedAnswers = event.expectedAnswers;
  if (event.type === "tune-candidate") {
    const key = `${event.stage}|${event.task ?? ""}|${event.axis}`;
    if (live.axis?.key !== key) live.axis = { key, stage: event.stage, task: event.task ?? null, axis: event.axis, candidates: [] };
    const candidate = { patch: event.patch, rung: event.rung, rate: event.rate, latencyMs: event.latencyMs ?? null, outputTokens: event.outputTokens ?? null };
    const same = live.axis.candidates.findIndex((entry) => JSON.stringify(entry.patch) === JSON.stringify(event.patch));
    if (same >= 0) live.axis.candidates[same] = candidate;
    else live.axis.candidates.push(candidate);
  }
  if (event.type === "tune-sweep") {
    live.decisions.push({ stage: event.stage, task: event.task ?? null, axis: event.axis, winner: event.winner, changed: Boolean(event.changed), kept: event.kept ?? null, reason: event.reason ?? null });
    if (live.decisions.length > KEPT_DECISIONS) live.decisions.shift();
  }
}

function parseEvent(line) {
  const text = String(line ?? "").trim();
  if (!text.startsWith("{")) return null;
  try {
    const event = JSON.parse(text);
    return event && typeof event.type === "string" ? event : null;
  } catch {
    return null;
  }
}

function pushLog(item, line) {
  const text = String(line ?? "").trim();
  if (!text) return;
  item.log.push(text.slice(0, 300));
  if (item.log.length > LOG_LINES) item.log.splice(0, item.log.length - LOG_LINES);
}

/** "gpu" when the model's profile chose a GPU in its device stage, else "cpu". */
async function laneFromProfile(profilesDir, model) {
  if (!profilesDir) return "cpu";
  try {
    const profile = JSON.parse(await fs.promises.readFile(path.join(profilesDir, `${model.profileId}.json`), "utf8"));
    const backend = profile?.device?.settings?.gpuBackend;
    return backend && backend !== "cpu" ? "gpu" : "cpu";
  } catch {
    return "cpu";
  }
}
