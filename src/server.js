import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { AppError } from "./errors.js";
import { selectChatBase } from "./benchmark-base.js";
import { loadBenchmarkReport } from "./benchmark-report.js";
import { manifestSummary } from "./generation-manifest.js";
import {
  applyCorsHeaders,
  applySecurityHeaders,
  isApiV1Path,
  isCrossSiteRequest,
  isLoopbackRequest,
  readJsonBody,
  requiresApiAuth,
  sendError,
  sendJson,
  servePublicFile,
  sseComment,
  sseSend,
  sseStart,
} from "./http.js";
import { publicCatalog } from "./model-catalog.js";
import { currentFingerprint, isPartRun, listProfiles, loadProfile, profileIdFor } from "./model-profiles.js";
import { answersFile, listRuns, loadRun, summarizeAnswers } from "./tune-runs.js";
import { TunedSettings } from "./tuned-settings.js";
import { readSteps, writeSteps } from "./tune-steps.js";
import { DEFAULT_STEPS, estimateTune, settingNames } from "../benchmarks/tune-grid.mjs";
import { handleOpenAI } from "./openai.js";
import { settingPresets } from "./config.js";
import { systemInfo } from "./system.js";

// Live tune updates: changes within this window go out together; a comment keeps idle connections open.
const STREAM_BATCH_MS = 250;
const STREAM_HEARTBEAT_MS = 15_000;

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const BENCHMARK_DIR = fileURLToPath(new URL("../benchmarks", import.meta.url));

function openFolder(folder, logger) {
  const command =
    process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  execFile(command, [folder], (error) => {
    if (error) logger.warn?.(`[modelduck] Could not open ${folder}: ${error.message}`);
  });
}

function normalizeMessageText(value) {
  if (typeof value !== "string") {
    throw new AppError("Message must be text", {
      code: "invalid_message",
      why: "ModelDuck expects the message field to be a string.",
      fix: "Send plain text in the message field.",
    });
  }
  const text = value.trim();
  if (!text) {
    throw new AppError("The message is empty", {
      code: "empty_message",
      why: "There is nothing for the model to answer.",
      fix: "Type a message, then press Send.",
    });
  }
  if (text.length > 32_000) {
    throw new AppError("That message is too long", {
      code: "message_too_long",
      status: 413,
      why: "ModelDuck accepts messages up to 32,000 characters.",
      fix: "Shorten the message, or split it into smaller parts.",
    });
  }
  return text;
}

export function createHttpServer({
  settings,
  chatStore,
  registry,
  engine,
  downloads,
  serverSettings = null,
  jit = null,
  benchmarks = null,
  tunes = null,
  logger = console,
  publicDir = PUBLIC_DIR,
  benchmarkDir = BENCHMARK_DIR,
  profilesDir = null,
  tuneRunsDir = null,
  profileFingerprint = currentFingerprint,
  tuneStepsFile = null,
}) {
  const activeChats = new Set();
  const tuned = new TunedSettings({ profilesDir, registry, settings, fingerprint: profileFingerprint });
  const tunedInfo = (applied) => applied && { catalogId: applied.catalogId, task: applied.task, speedPreset: applied.speedPreset, stages: applied.stages, systemPrompt: applied.settings.systemPrompt ?? null, stale: applied.stale, warnings: applied.warnings };

  async function handleChat(req, res) {
    const body = await readJsonBody(req);
    const message = normalizeMessageText(body.message);
    const regenerate = body.regenerate === true;
    let conversation = null;

    if (body.conversationId) {
      conversation = chatStore.get(String(body.conversationId));
      if (!conversation) {
        throw new AppError("Conversation not found", {
          code: "conversation_not_found",
          status: 404,
          why: "That conversation no longer exists.",
          fix: "Start a new chat.",
        });
      }
    }

    if (!engine || (await engine.status()).status !== "ready") {
      throw new AppError("No model is loaded", {
        code: "model_not_loaded",
        status: 409,
        why: "ModelDuck needs a loaded model before it can answer.",
        fix: "Open Models, load an installed model, then send your message again.",
      });
    }
    if (engine.busy) {
      throw new AppError("The duck is already answering", {
        code: "generation_in_progress",
        status: 409,
        why: "ModelDuck runs one generation at a time on the CPU.",
        fix: "Wait for the other reply to finish, or stop it first.",
      });
    }

    const loaded = await engine.status();
    const applied = await tuned.resolve(loaded.model?.id ?? null, body.task ? String(body.task) : "chat");
    if (!conversation) {
      conversation = chatStore.create({
        modelId: loaded.model?.id ?? null,
        modelName: loaded.model?.name ?? null,
        title: message,
      });
    }
    if (conversation.modelId !== loaded.model?.id) {
      chatStore.setModel(conversation.id, {
        modelId: loaded.model?.id ?? null,
        modelName: loaded.model?.name ?? null,
      });
      conversation = chatStore.get(conversation.id);
    }

    if (activeChats.has(conversation.id)) {
      throw new AppError("A reply is already running", {
        code: "generation_in_progress",
        status: 409,
        why: "This conversation is already generating a reply.",
        fix: "Click Stop, or wait for the reply to finish.",
      });
    }

    if (regenerate) {
      conversation = chatStore.truncateToLastUser(conversation.id);
    }
    const last = conversation.messages.at(-1);
    if (!last || last.role !== "user" || last.content !== message) {
      chatStore.appendMessage(conversation.id, { role: "user", content: message });
    }
    await chatStore.save();
    conversation = chatStore.get(conversation.id);

    activeChats.add(conversation.id);
    const controller = new AbortController();
    let finished = false;
    let heartbeat = null;

    sseStart(res);
    sseSend(res, "meta", {
      conversationId: conversation.id,
      title: conversation.title,
      model: loaded.model,
      startedAt: new Date().toISOString(),
    });

    const abort = () => {
      controller.abort();
      engine.abort(conversation.id);
    };
    res.on("close", () => {
      if (!finished) abort();
    });
    heartbeat = setInterval(() => {
      if (!res.destroyed) sseComment(res);
    }, 15_000);
    heartbeat.unref?.();

    try {
      const result = await engine.chat({
        conversationId: conversation.id,
        messages: conversation.messages,
        systemPrompt: applied?.settings.systemPrompt ?? settings.value.systemPrompt,
        settings: { ...settings.value, ...(applied?.settings ?? {}) },
        signal: controller.signal,
        onToken: (chunk) => {
          if (res.destroyed) {
            controller.abort();
            return;
          }
          sseSend(res, "token", { text: chunk });
        },
      });

      let assistant = null;
      const manifest = manifestSummary(result.manifest);
      if (result.text || !result.aborted) {
        assistant = chatStore.appendMessage(conversation.id, {
          role: "assistant",
          content: result.text,
          stats: result.stats,
          manifest,
          stopped: result.aborted,
        });
        await chatStore.save();
      }
      conversation = chatStore.get(conversation.id);
      if (!res.destroyed) {
        sseSend(res, "done", {
          conversationId: conversation.id,
          title: conversation.title,
          message: assistant,
          stats: result.stats,
          manifest,
          aborted: result.aborted,
          tuned: tunedInfo(applied),
        });
      }
    } catch (error) {
      if (!res.destroyed) {
        sseSend(res, "error", {
          code: error?.code || "generation_failed",
          message: error?.message || "The model could not answer",
          why: error?.why || "Generation failed before a reply was completed.",
          fix: error?.fix || "Try again, or unload and reload the model.",
        });
      }
    } finally {
      finished = true;
      if (heartbeat) clearInterval(heartbeat);
      activeChats.delete(conversation.id);
      if (!res.destroyed) res.end();
    }
  }

  async function route(req, res) {
    applySecurityHeaders(res);
    const serverConfig = serverSettings?.value ?? {};
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;
    const method = req.method || "GET";
    const corsRoute = Boolean(serverConfig.enableCors) && isApiV1Path(pathname);
    if (corsRoute) applyCorsHeaders(res);
    if (!isLoopbackRequest(req, { allowLan: Boolean(serverConfig.serveOnLocalNetwork) })) {
      sendJson(res, 403, {
        error: {
          code: "forbidden_host",
          message: "Request refused",
          why: "ModelDuck only accepts requests addressed to this computer.",
          fix: "Open the loopback URL, or enable Serve on Local Network in Server settings.",
        },
      });
      return;
    }

    if (isCrossSiteRequest(req) && !corsRoute) {
      sendJson(res, 403, {
        error: {
          code: "cross_site_refused",
          message: "Request refused",
          why: "A web page from another site tried to use ModelDuck through your browser.",
          fix: "Use the ModelDuck UI itself. Browser apps may call /v1 only when Enable CORS is on and they send an API key.",
        },
      });
      return;
    }

    if (method === "OPTIONS" && corsRoute) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requiresApiAuth(req, { requireAuth: serverConfig.requireAuth, pathname })) {
      const header = String(req.headers.authorization || "");
      const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
      const supplied = bearer || String(req.headers["x-api-key"] || "");
      if (!serverSettings.verifyKey(supplied)) {
        res.setHeader("WWW-Authenticate", "Bearer");
        sendJson(res, 401, {
          error: {
            code: "unauthorized",
            message: "Authentication required",
            why: "Require Authentication is enabled for this server and the request did not carry a valid key.",
            fix: "Send Authorization: Bearer <key> or X-API-Key: <key>, or use the loopback UI on this computer.",
          },
        });
        return;
      }
    }

    if (method === "OPTIONS") {
      sendJson(res, 405, {
        error: { code: "method_not_allowed", message: "Cross-origin requests are not supported" },
      });
      return;
    }

    if (method === "GET" && pathname === "/health") {
      const status = engine ? await engine.status() : { status: "idle" };
      sendJson(res, 200, { ok: true, status: status.status, model: status.model ?? null });
      return;
    }

    if (pathname === "/api/state" && method === "GET") {
      const [models, loaded] = await Promise.all([
        registry ? registry.scan() : [],
        engine ? engine.status() : { status: "idle" },
      ]);
      sendJson(res, 200, {
        app: systemInfo(),
        settings: settings.value,
        presets: settingPresets(),
        serverSettings: serverSettings
          ? {
              ...serverSettings.value,
              apiKeys: serverSettings.listKeys(),
              activeKeys: serverSettings.activeKeys,
            }
          : null,
        modelsDir: registry?.modelsDir ?? null,
        models,
        loaded,
        catalog: publicCatalog(),
        downloads: downloads ? downloads.list() : [],
        conversations: chatStore.list(),
        archivedConversations: chatStore.listArchived(),
      });
      return;
    }

    if (pathname === "/api/status" && method === "GET") {
      sendJson(res, 200, {
        loaded: engine ? await engine.status() : { status: "idle" },
        downloads: downloads ? downloads.list() : [],
      });
      return;
    }

    if (pathname === "/api/gpu" && method === "GET") {
      const module = await import("node-llama-cpp");
      const backends = await module.getLlamaGpuTypes();
      sendJson(res, 200, {
        backends,
        rocm: false,
        note: "ROCm is not exposed by node-llama-cpp; use Vulkan for AMD GPUs.",
      });
      return;
    }

    if (pathname === "/api/benchmarks" && method === "GET") {
      sendJson(res, 200, await loadBenchmarkReport({ benchmarkDir }));
      return;
    }

    if (pathname === "/api/benchmarks/status" && method === "GET") {
      sendJson(res, 200, { job: benchmarks ? benchmarks.get() : null });
      return;
    }

    if (pathname === "/api/benchmarks/base" && method === "POST") {
      if (!benchmarks) throw new AppError("Benchmark runner unavailable", { status: 503 });
      if (!isLoopbackRequest(req)) {
        throw new AppError("Benchmarks run only on this computer", {
          code: "benchmark_local_only",
          status: 403,
          why: "Choosing the chat base is part of the local benchmark.",
          fix: "Open the ModelDuck UI on the computer running the server.",
        });
      }
      if (benchmarks.get()?.status === "running") {
        throw new AppError("A benchmark is already running", {
          code: "benchmark_in_progress",
          status: 409,
          why: "The chat base cannot change while a benchmark is using it.",
          fix: "Wait for the run to finish, or cancel it first.",
        });
      }
      const body = await readJsonBody(req);
      const selection = await selectChatBase({
        benchmarkDir,
        variantId: String(body.variantId ?? ""),
      });
      sendJson(res, 200, { chatBase: selection });
      return;
    }

    if (pathname === "/api/benchmarks/run" && method === "POST") {
      if (!benchmarks) throw new AppError("Benchmark runner unavailable", { status: 503 });
      if (!isLoopbackRequest(req)) {
        throw new AppError("Benchmarks run only on this computer", {
          code: "benchmark_local_only",
          status: 403,
          why: "A benchmark loads every model in the matrix and takes the whole CPU for a long time.",
          fix: "Open the ModelDuck UI on the computer running the server.",
        });
      }
      if (engine?.busy) {
        throw new AppError("The duck is already answering", {
          code: "generation_in_progress",
          status: 409,
          why: "Benchmarking and chatting cannot share the CPU without skewing the measurements.",
          fix: "Wait for the reply to finish, then start the benchmark.",
        });
      }
      if (tunes?.get()?.status === "running") {
        throw new AppError("A tune is running", {
          code: "tune_in_progress",
          status: 409,
          why: "Benchmarking beside a tune would skew both measurements.",
          fix: "Wait for the tune to finish, or cancel it first.",
        });
      }
      const body = await readJsonBody(req);
      sendJson(res, 202, {
        job: benchmarks.start({
          phase: body.phase ?? "model",
          updateBaseline: body.updateBaseline === true,
          download: body.download === true,
          fullMatrix: body.fullMatrix === true,
          model: body.model ? String(body.model) : null,
          tasks: Array.isArray(body.tasks) ? body.tasks.map(String) : null,
          force: body.force === true,
          stages: Array.isArray(body.stages) ? body.stages.map(String) : null,
        }),
      });
      return;
    }

    if (pathname === "/api/tune/overview" && method === "GET") {
      // Every installed model with its tuned profile, without the sweep log and resume state.
      const models = [];
      for (const model of registry.listPublic()) {
        const profileId = profileIdFor(model.fileName);
        const loaded = profilesDir ? await loadProfile(profilesDir, profileId, await profileFingerprint(model)).catch(() => null) : null;
        const { sweeps: _sweeps, progress: _progress, ...profile } = loaded?.profile ?? {};
        models.push({
          id: model.id,
          name: model.name,
          fileName: model.fileName,
          profileId,
          profile: loaded ? profile : null,
          stale: loaded?.stale ?? [],
          staleParts: loaded?.staleParts ?? [],
          deviceParts: loaded?.deviceParts ?? [],
          warnings: loaded?.warnings ?? [],
        });
      }
      sendJson(res, 200, { models });
      return;
    }

    // Every tune run with its statistics and answers (ADR-050).
    if (pathname === "/api/tune/runs" && method === "GET") {
      sendJson(res, 200, { runs: tuneRunsDir ? await listRuns(tuneRunsDir) : [] });
      return;
    }
    const runMatch = pathname.match(/^\/api\/tune\/runs\/([^/]+)(\/answers)?$/);
    if (runMatch && method === "GET") {
      const id = decodeURIComponent(runMatch[1]);
      const run = tuneRunsDir ? await loadRun(tuneRunsDir, id) : null;
      if (!run) {
        throw new AppError("Tune run not found", { code: "tune_run_missing", status: 404, why: `There is no saved tune run ${id}.`, fix: "Pick a run from the list of tune runs." });
      }
      if (!runMatch[2]) {
        sendJson(res, 200, { run, answers: await summarizeAnswers(tuneRunsDir, id) });
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "content-disposition": `attachment; filename="tune-run-${id}.jsonl"` });
      const stream = fs.createReadStream(answersFile(tuneRunsDir, id));
      stream.on("error", () => res.end());
      stream.pipe(res);
      return;
    }

    // A running tune, pushed to the Bench panel as it changes (ADR-055).
    if (pathname === "/api/tune/stream" && method === "GET") {
      if (!tunes?.subscribe) throw new AppError("Tune scheduler unavailable", { status: 503 });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      const send = () => res.write(`data: ${JSON.stringify({ job: tunes.get() ?? null })}\n\n`);
      send();
      // Changes come in bursts (every answer); a quarter second is live enough.
      let pending = null;
      const stop = tunes.subscribe(() => {
        pending ??= setTimeout(() => {
          pending = null;
          send();
        }, STREAM_BATCH_MS);
      });
      const heartbeat = setInterval(() => res.write(`: keep-alive\n\n`), STREAM_HEARTBEAT_MS);
      req.on("close", () => {
        stop();
        clearTimeout(pending);
        clearInterval(heartbeat);
      });
      return;
    }

    if (pathname === "/api/tune/status" && method === "GET") {
      sendJson(res, 200, { job: tunes?.get() ?? null });
      return;
    }

    if (pathname === "/api/tune/start" && method === "POST") {
      if (!tunes) throw new AppError("Tune scheduler unavailable", { status: 503 });
      if (!isLoopbackRequest(req)) {
        throw new AppError("Tunes run only on this computer", {
          code: "tune_local_only",
          status: 403,
          why: "A tune loads models one after another and takes the CPU and GPU for a long time.",
          fix: "Open the ModelDuck UI on the computer running the server.",
        });
      }
      if (engine?.busy || benchmarks?.get()?.status === "running") {
        throw new AppError("The duck is busy", {
          code: "generation_in_progress",
          status: 409,
          why: "A reply or benchmark is running; tuning beside it would skew both.",
          fix: "Wait for it to finish, then start the tune.",
        });
      }
      const body = await readJsonBody(req);
      const installed = registry.listPublic();
      const wanted = body.models === "all" ? installed.map((model) => model.id) : (Array.isArray(body.models) ? body.models.map(String) : []);
      const models = wanted.map((id) => {
        const model = installed.find((item) => item.id === id);
        if (!model) {
          throw new AppError("Model not found", { code: "model_not_found", status: 404, why: `${id} is not in the local model library.`, fix: "Pick an installed model." });
        }
        return { id: model.id, fileName: model.fileName, profileId: profileIdFor(model.fileName), name: model.name };
      });
      const only = Array.isArray(body.settings) && body.settings.length ? body.settings.map(String) : null;
      const stages = Array.isArray(body.stages) ? body.stages.map(String) : null;
      // forceStale starts over only where the saved profile was measured on another suite, runtime or machine,
      // and only for a whole tune: a part run re-measures its parts on top of the saved rest (ADR-040).
      // Continuing never starts over: it finishes what the earlier run left (ADR-051).
      if (body.forceStale === true && profilesDir && !isPartRun(stages, only) && body.continue !== true) {
        for (const model of models) {
          const entry = installed.find((item) => item.id === model.id);
          const saved = await loadProfile(profilesDir, model.profileId, await profileFingerprint(entry)).catch(() => null);
          model.force = Boolean(saved?.stale.length);
        }
      }
      const unknownSettings = (only ?? []).filter((name) => !settingNames().includes(name));
      if (unknownSettings.length) {
        throw new AppError("Unknown setting", { code: "unknown_setting", status: 400, why: `${unknownSettings.join(", ")} is not a tunable setting.`, fix: `Use any of: ${settingNames().join(", ")}.` });
      }
      if (!models.length) throw new AppError("Choose a model to tune", { code: "tune_model_required", why: "No model was named.", fix: "Pick an installed model, or send models: \"all\"." });
      sendJson(res, 202, {
        job: tunes.start({
          models,
          tasks: Array.isArray(body.tasks) ? body.tasks.map(String) : null,
          stages,
          settings: only,
          force: body.force === true,
          continueRun: body.continue === true,
        }),
      });
      return;
    }

    if (pathname === "/api/tune/cancel" && method === "POST") {
      if (!tunes) throw new AppError("Tune scheduler unavailable", { status: 503 });
      if (!isLoopbackRequest(req)) {
        throw new AppError("Tunes are controlled only on this computer", {
          code: "tune_local_only",
          status: 403,
          why: "Tunes take the CPU and GPU for a long time; only the computer running them may start, stop or reconfigure them.",
          fix: "Open the ModelDuck UI on the computer running the server.",
        });
      }
      sendJson(res, 200, { job: tunes.cancel() });
      return;
    }

    if (pathname === "/api/tune/steps" && (method === "GET" || method === "PUT")) {
      if (!tuneStepsFile) throw new AppError("Tune steps unavailable", { status: 503 });
      if (method === "PUT") {
        if (!isLoopbackRequest(req)) {
          throw new AppError("Tunes are controlled only on this computer", {
            code: "tune_local_only",
            status: 403,
            why: "Tunes take the CPU and GPU for a long time; only the computer running them may start, stop or reconfigure them.",
            fix: "Open the ModelDuck UI on the computer running the server.",
          });
        }
      }
      const result = method === "PUT"
        ? await writeSteps(tuneStepsFile, (await readJsonBody(req)).steps ?? {})
        : await readSteps(tuneStepsFile);
      const logicalCores = systemInfo().parallelism;
      sendJson(res, 200, { ...result, defaults: DEFAULT_STEPS, settingNames: settingNames(), logicalCores, estimate: estimateTune(result.steps, { logicalCores }) });
      return;
    }

    if (pathname === "/api/profiles" && method === "GET") {
      sendJson(res, 200, { profiles: profilesDir ? await listProfiles(profilesDir) : [] });
      return;
    }

    const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
    if (profileMatch && method === "GET") {
      const id = decodeURIComponent(profileMatch[1]);
      const entry = registry.listPublic().find((model) => profileIdFor(model.fileName) === id) ?? null;
      const loaded = profilesDir ? await loadProfile(profilesDir, id, await profileFingerprint(entry)) : null;
      if (!loaded) {
        throw new AppError("This model has not been tuned", {
          code: "profile_missing",
          status: 404,
          why: `There is no saved profile for ${id}.`,
          fix: "Start a tune for it from the Bench panel, or run npm run tune -- --model <id>.",
        });
      }
      sendJson(res, 200, loaded);
      return;
    }

    if (pathname === "/api/benchmarks/cancel" && method === "POST") {
      if (!benchmarks) throw new AppError("Benchmark runner unavailable", { status: 503 });
      if (!isLoopbackRequest(req)) {
        throw new AppError("Benchmarks run only on this computer", {
          code: "benchmark_local_only",
          status: 403,
          why: "Only the computer running the benchmark can stop it.",
          fix: "Open the ModelDuck UI on the computer running the server.",
        });
      }
      sendJson(res, 200, { job: benchmarks.cancel() });
      return;
    }

    if (pathname === "/api/settings" && method === "GET") {
      sendJson(res, 200, { settings: settings.value });
      return;
    }

    if (pathname === "/api/settings" && method === "PUT") {
      const body = await readJsonBody(req);
      const next = await settings.update(body.settings ?? body);
      sendJson(res, 200, { settings: next });
      return;
    }

    if (pathname === "/api/server-settings" && method === "GET") {
      if (!serverSettings) throw new AppError("Server settings unavailable", { status: 503 });
      sendJson(res, 200, {
        settings: serverSettings.value,
        apiKeys: serverSettings.listKeys(),
        activeKeys: serverSettings.activeKeys,
      });
      return;
    }

    if (pathname === "/api/server-settings" && method === "PUT") {
      if (!serverSettings) throw new AppError("Server settings unavailable", { status: 503 });
      const body = await readJsonBody(req);
      const next = await serverSettings.update(body.settings ?? body);
      sendJson(res, 200, {
        settings: next,
        apiKeys: serverSettings.listKeys(),
        activeKeys: serverSettings.activeKeys,
        restartRequired: true,
      });
      return;
    }

    if (pathname === "/api/server-settings/api-keys" && method === "POST") {
      if (!serverSettings) throw new AppError("Server settings unavailable", { status: 503 });
      const body = await readJsonBody(req);
      const created = await serverSettings.createKey(body.label);
      sendJson(res, 201, {
        key: created.key,
        record: created.record,
        activeKeys: serverSettings.activeKeys,
      });
      return;
    }

    const routeMatch = pathname.match(/^\/api\/server-settings\/api-keys\/([^/]+)$/);
    if (routeMatch && method === "DELETE") {
      if (!serverSettings) throw new AppError("Server settings unavailable", { status: 503 });
      const deleted = await serverSettings.revokeKey(decodeURIComponent(routeMatch[1]));
      if (!deleted) {
        throw new AppError("API key not found", {
          code: "api_key_not_found",
          status: 404,
          why: "That API key does not exist.",
          fix: "Refresh Server settings.",
        });
      }
      sendJson(res, 200, { deleted: true, activeKeys: serverSettings.activeKeys });
      return;
    }

    if (pathname === "/api/models" && method === "GET") {
      sendJson(res, 200, {
        models: registry ? await registry.scan() : [],
        modelsDir: registry?.modelsDir ?? null,
      });
      return;
    }
    if (pathname === "/api/models/import" && method === "POST") {
      if (!registry) throw new AppError("Model library unavailable", { status: 503 });
      const body = await readJsonBody(req);
      const model = await registry.importFromPath(body.path);
      sendJson(res, 201, { model, models: await registry.scan() });
      return;
    }

    if (pathname === "/api/models/open-folder" && method === "POST") {
      if (!registry) throw new AppError("Model library unavailable", { status: 503 });
      openFolder(registry.modelsDir, logger);
      sendJson(res, 200, { ok: true, path: registry.modelsDir });
      return;
    }

    if (pathname === "/api/models/unload" && method === "POST") {
      if (engine) await engine.unload();
      jit?.clear();
      sendJson(res, 200, { loaded: engine ? await engine.status() : { status: "idle" } });
      return;
    }

    const loadMatch = pathname.match(/^\/api\/models\/([^/]+)\/load$/);
    if (loadMatch && method === "POST") {
      if (!engine) throw new AppError("Inference engine unavailable", { status: 503 });
      const body = await readJsonBody(req);
      const modelId = decodeURIComponent(loadMatch[1]);
      const applied = await tuned.resolve(modelId);
      const loaded = await engine.load({
        modelId,
        contextSize: body.contextSize ?? settings.value.contextSize,
        threads: body.threads ?? settings.value.threads,
        maxThreads: body.maxThreads ?? settings.value.maxThreads,
        batchSize: body.batchSize ?? settings.value.batchSize,
        sequences: body.sequences ?? settings.value.sequences,
        flashAttention: body.flashAttention ?? settings.value.flashAttention,
        useMmap: body.useMmap ?? settings.value.useMmap,
        gpuLayers: body.gpuLayers ?? settings.value.gpuLayers,
        gpuBackend: body.gpuBackend ?? settings.value.gpuBackend,
        checkpoints: body.checkpoints ?? settings.value.checkpoints,
        checkpointInterval: body.checkpointInterval ?? settings.value.checkpointInterval,
        checkpointMax: body.checkpointMax ?? settings.value.checkpointMax,
        kvCache: body.kvCache ?? settings.value.kvCache,
        ...(applied?.settings ?? {}),
        force: body.force === true,
      });
      jit?.clear();
      sendJson(res, 200, { loaded, tuned: tunedInfo(applied) });
      return;
    }

    const modelMatch = pathname.match(/^\/api\/models\/([^/]+)$/);
    if (modelMatch && method === "DELETE") {
      if (!registry) throw new AppError("Model library unavailable", { status: 503 });
      const deleted = await registry.deleteById(decodeURIComponent(modelMatch[1]), {
        loadedId: engine?.loadedId ?? null,
      });
      sendJson(res, 200, { deleted, models: await registry.scan() });
      return;
    }

    if (pathname === "/api/catalog" && method === "GET") {
      sendJson(res, 200, {
        catalog: publicCatalog(),
        models: registry ? await registry.scan() : [],
        modelsDir: registry?.modelsDir ?? null,
        downloads: downloads ? downloads.list() : [],
      });
      return;
    }

    if (pathname === "/api/downloads" && method === "GET") {
      sendJson(res, 200, { downloads: downloads ? downloads.list() : [] });
      return;
    }

    if (pathname === "/api/downloads" && method === "POST") {
      if (!downloads) throw new AppError("Downloads unavailable", { status: 503 });
      const body = await readJsonBody(req);
      const job = await downloads.start(String(body.catalogId ?? body.modelId ?? ""));
      sendJson(res, 202, { download: job });
      return;
    }

    const downloadMatch = pathname.match(/^\/api\/downloads\/([^/]+)$/);
    if (downloadMatch && method === "DELETE") {
      if (!downloads) throw new AppError("Downloads unavailable", { status: 503 });
      const job = await downloads.cancel(decodeURIComponent(downloadMatch[1]));
      sendJson(res, 200, { download: job });
      return;
    }

    if (pathname === "/api/conversations" && method === "GET") {
      sendJson(res, 200, { conversations: chatStore.list(), archived: chatStore.listArchived() });
      return;
    }

    if (pathname === "/api/conversations" && method === "POST") {
      const body = await readJsonBody(req);
      const loaded = engine ? await engine.status() : { status: "idle" };
      const conversation = chatStore.create({
        modelId: loaded.model?.id ?? null,
        modelName: loaded.model?.name ?? null,
        title: body.title || "New chat",
      });
      await chatStore.save();
      sendJson(res, 201, { conversation });
      return;
    }

    const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationMatch && method === "GET") {
      const id = decodeURIComponent(conversationMatch[1]);
      let conversation = chatStore.get(id);
      if (!conversation) {
        conversation = chatStore.restore(id);
        if (conversation) await chatStore.save();
      }
      if (!conversation) {
        throw new AppError("Conversation not found", {
          code: "conversation_not_found",
          status: 404,
          why: "That conversation no longer exists.",
          fix: "Start a new chat.",
        });
      }
      sendJson(res, 200, { conversation });
      return;
    }

    if (conversationMatch && method === "PATCH") {
      const body = await readJsonBody(req);
      const conversation = chatStore.rename(decodeURIComponent(conversationMatch[1]), body.title);
      if (!conversation) {
        throw new AppError("Conversation not found", {
          code: "conversation_not_found",
          status: 404,
          why: "That conversation no longer exists.",
          fix: "Start a new chat.",
        });
      }
      await chatStore.save();
      sendJson(res, 200, { conversation });
      return;
    }

    if (conversationMatch && method === "DELETE") {
      const id = decodeURIComponent(conversationMatch[1]);
      engine?.abort(id);
      engine?.dropSession(id);
      const deleted = chatStore.delete(id);
      if (!deleted) {
        throw new AppError("Conversation not found", {
          code: "conversation_not_found",
          status: 404,
          why: "That conversation no longer exists.",
          fix: "Start a new chat.",
        });
      }
      await chatStore.save();
      sendJson(res, 200, { deleted: true });
      return;
    }

    if (pathname === "/api/chat" && method === "POST") {
      await handleChat(req, res);
      return;
    }

    if (pathname === "/api/chat/abort" && method === "POST") {
      const body = await readJsonBody(req);
      const aborted = engine?.abort(String(body.conversationId ?? "")) ?? false;
      sendJson(res, 200, { aborted });
      return;
    }

    if (
      pathname === "/v1/models" ||
      pathname.startsWith("/v1/models/") ||
      pathname === "/v1/chat/completions" ||
      pathname === "/v1/completions"
    ) {
      await handleOpenAI(req, res, {
        tuned,
        engine,
        registry,
        settings,
        serverSettings,
        jit,
        logger,
      });
      return;
    }

    if (method === "GET" || method === "HEAD") {
      if (await servePublicFile(req, res, publicDir, pathname)) return;
      sendJson(res, 404, {
        error: {
          code: "not_found",
          message: "Not found",
          why: "ModelDuck has no page at this address.",
          fix: "Open http://127.0.0.1:4141.",
        },
      });
      return;
    }

    throw new AppError("Method not allowed", {
      code: "method_not_allowed",
      status: 405,
      why: `${method} is not supported at ${pathname}.`,
      fix: "Use the ModelDuck web interface or the documented API routes.",
    });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (res.headersSent) {
        if (!res.destroyed) res.end();
        return;
      }
      if (error?.status === 500 || !error?.status) {
        logger.error?.(`[modelduck] ${error?.stack || error}`);
      }
      sendError(res, error);
    });
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return server;
}
