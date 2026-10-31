# Decisions

Why this project is built the way it is, oldest first. One entry per decision that changes a
contract, a dependency, a data format or the architecture; IDs are consecutive and never reused.

<!-- Entry format:
### ADR-NNN: <decision in one line>
- **Date**: YYYY-MM-DD
- **Status**: Accepted
- **Context**: <what forced the decision>
- **Decision**: <what was decided>
- **Consequences**: <what follows, including what it costs>
-->


### ADR-001: Ship a local web app instead of a desktop shell
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The user needs a dependable replacement for LM Studio and Ollama, and asked for the easiest possible install. Electron or Tauri would add a second runtime, packaging pipeline and hundreds of megabytes before the first chat works.
- **Decision**: Serve the UI from the same Node process that runs inference. On Windows, start.bat opens it in an installed Edge/Chrome app window; otherwise the default browser opens. There is no build step and no UI framework.
- **Consequences**: One `npm install` and one `npm start` are enough. Closing the browser window leaves the local server running until Ctrl+C, which the README states. A future native shell can wrap the same HTTP surface without changing the engine.

### ADR-002: One CPU-first llama.cpp context, one generation at a time
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: A 16 GB machine without a usable GPU must load small GGUF models predictably. Multiple contexts multiply KV-cache memory, and parallel generations on the same CPU make every reply slower.
- **Decision**: Use node-llama-cpp with GPU disabled unless `MODELDUCK_GPU=auto`; load one model and one context, reject a second concurrent generation with an actionable 409, and rebuild the chat session from the atomic conversation store when the active conversation changes. Context creation retries at smaller sizes before failing.
- **Consequences**: RAM use stays close to one model plus one context. Switching conversations loses the KV cache and pays prompt processing again. The UI and OpenAI endpoint share one fair queue and cannot corrupt each other's session.

### ADR-003: Benchmark quality and speed on three model classes
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Token throughput alone cannot show whether a change improved the product. The user requires every generation-affecting change to exercise at least three small, different model types and compare the result.
- **Decision**: Add `npm run bench`, a deterministic nine-task suite (instruction following, arithmetic, facts, reasoning, JSON, JavaScript syntax, formatting, list cardinality, long-context recall) run through the real LlamaEngine on SmolLM2 135M, Qwen2.5 0.5B and Qwen2.5 Coder 1.5B. Quality is compared exactly with `benchmarks/baseline.json`; speed is the median generated tokens per second and warns beyond a 20% drop.
- **Consequences**: The gate takes minutes and needs the three model files, so it is an explicit pre-checkpoint step rather than part of `npm test`. Generated code is syntax-checked by `node --check`, never executed. A deliberate quality change requires a reviewed baseline update.


### ADR-004: Keep benchmark history in SQLite with an append-only JSONL export
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Quality and speed only help if each change can be compared with the commit that produced it. A single baseline file has no trend, and a binary database alone is not reviewable in a diff.
- **Decision**: `npm run bench` records each run in a local `benchmarks/history.sqlite` database (`runs`, `model_results`, `prompt_results`, `commits`) and appends the same run to `benchmarks/history.jsonl`. A run made before its commit is marked pending; `npm run bench:link` attaches it to the new HEAD. The JSONL file is tracked and can rebuild the database with `npm run bench:report -- --rebuild`.
- **Consequences**: Progress is queryable per model and per commit without storing model weights. The SQLite file is ignored so binary churn stays out of git, while the tracked JSONL keeps the record reviewable. Node 22+ is needed for `node:sqlite` in the benchmark tooling; the app itself remains Node 20+.


### ADR-005: Separate model-reload and model-usage benchmark gates
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Loading parameters and sampling parameters change different things. Mixing them hides whether a quality delta came from the model file, the KV cache, the context configuration, the sampler or a changed test.
- **Decision**: `npm run bench:model` runs one-factor reload variants and `npm run bench:chat` runs generation/sampling variants on the configuration chosen by the first phase. Both record a SHA-256 test hash over prompts, checks and matrix entries; the changelog plus `SUITE_VERSION` distinguishes test edits from parameter changes.
- **Consequences**: A model change is judged before sampling tuning. Baselines are separate. A test edit requires a deliberate baseline update and cannot masquerade as a model improvement.

### ADR-006: API server settings, keys, CORS and JIT loading
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: LM Studio-style local serving needs a controllable port, optional API keys, LAN access, CORS and lazy model loading without making the browser UI depend on them.
- **Decision**: Persist `server-settings.json` with port, auth, LAN, CORS, JIT and idle policy. Store only SHA-256 hashes of API keys, return a raw key once, protect `/v1/*`, and keep JIT unload from touching a busy engine. MCP toggles are stored but no MCP transport is claimed.
- **Consequences**: Auth/CORS and JIT are opt-in and configurable without restarting the UI. Port/LAN changes need a restart. The local UI remains loopback-first.

### ADR-007: GPU backend selection with CPU fallback
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: node-llama-cpp can use CUDA, Vulkan and Metal, but a missing driver or build must not prevent local chat. ROCm is not exposed by the binding.
- **Decision**: Add `gpuBackend` (`cpu`, `auto`, `cuda`, `vulkan`, `metal`) and `gpuLayers`. Explicit backends fail with an actionable error; `auto` falls back to CPU. AMD uses Vulkan because ROCm is unavailable in this runtime.
- **Consequences**: CPU remains the default. GPU builds may require vendor toolchains, which is reported rather than hidden.

### ADR-008: Fingerprint every generation and every changed benchmark input
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The benchmark test hash covered prompts, checks and most matrix fields, but not the global or per-variant system prompt, promptIds, the GGUF chat template, the runtime version or the truncated history the model actually received. A score change could therefore be attributed to settings when the governing prompt, template or runtime had changed.
- **Decision**: Add a generation manifest in `src/generation-manifest.js`. `engine.chat` builds the effective system prompt, the exact bounded history and the repeated prompt through the same helpers and returns a SHA-256 manifest covering model identity, chat-template hash, runtime version, prompt/history digests and sampling settings. Chat messages and the SSE done event store a digest-only summary; OpenAI responses expose the short digest as `system_fingerprint`; benchmark prompt results store manifest, prompt, history and template digests. The test hash now includes the global and per-variant system prompts, promptIds, effective sampling defaults and the manifest version. Baselines record runtime and manifest versions and refuse a mismatch unless `--update-baseline` is deliberately passed.
- **Consequences**: Two runs are comparable only when the test definition, runtime and manifest version match. Regenerating a baseline after a runtime or test change is explicit and logged. Message files and history rows grow by a small digest summary, not by a second copy of the prompt or history.

### ADR-009: LAN auth covers UI routes; session reuse is gated by exact history
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Authentication only covered `/v1/*`, so enabling LAN serving exposed `/api/*` and the browser UI to unauthenticated state changes. The engine also had a `historyLength` reuse check that was never advanced, so every multi-turn request rebuilt the chat session and lost KV-cache reuse.
- **Decision**: When authentication is enabled, `/v1/*` always needs a key and `/api/*` needs one when the TCP peer is not loopback. The loopback UI stays key-free; a LAN browser receives 401, is prompted once, and sends `X-API-Key` from session storage. Session reuse is allowed only when the bounded history is complete (no 40-message/48k-character truncation), the system prompt/context signature matches, and the stored history length equals the prior message count. A completed turn advances that count; aborts, errors and truncated histories dispose the session. JIT keep-last documentation now states that disabling it refuses a second model because the engine intentionally holds one.
- **Consequences**: LAN clients can use the UI or API with a key while the host needs none. Long conversations rebuild rather than risk a manifest/session mismatch. Reused sessions keep the KV cache and still match the generation manifest, which is derived from the same bounded history.

### ADR-010: Read-only benchmark report inside the app
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Per-test percentages, runtime, suite/test identity and linked commits were only visible through the CLI. The user asked for the benchmark results to be visible as part of the product, and the existing baselines/JSONL already contain the data.
- **Decision**: Add `src/benchmark-report.js`, a read-only summary over `baseline-model.json`, `baseline-chat.json` and `history.jsonl`. `GET /api/benchmarks` returns both phases with quality, speed, runtime, per-test percentages, suite/test hash and linked commit, plus recent runs. A **Bench** dialog renders it. Missing baselines return an empty report; the route never writes files, loads a model or touches SQLite.
- **Consequences**: The panel always reflects the last deliberate baseline, not an in-progress run. It works on Node 20 without `node:sqlite`. LAN auth applies because the route is under `/api/*`. No benchmark suite or test hash changes, so existing baselines stay valid.

### ADR-011: Surface detected GPU backends in Settings
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: `/api/gpu` could report which backends the installed runtime sees, but the Settings dialog never asked for it. Users had to guess whether CUDA, Vulkan or Metal was actually available before selecting a backend.
- **Decision**: On opening Settings, request `/api/gpu` and show the detected backend names, mapping the runtime's `false` entry to CPU and adding the ROCm note. Detection failures fall back to a CPU-only message. The CPU default and stored backend choice do not change.
- **Consequences**: The dialog is read-only and reflects the current runtime, not a benchmark. A missing or broken backend is visible before a failed model load. Detection happens only when Settings opens, so it adds no startup work.

### ADR-012: Verify manifests against a real model without changing baselines
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Unit tests prove the history helpers, but the benchmark runs one isolated prompt per conversation. Nothing exercised the live `engine.chat` path for session reuse, 40-message truncation, prompt repetition and template/runtime identity against a GGUF file.
- **Decision**: Add `npm run verify:manifest -- --models-dir <folder>`. It defaults to Qwen2.5 0.5B Q4 (or the first installed model), patches `setChatHistory` only to count calls, and checks: the second turn reuses the session; a 45-pair history truncates to 40 messages with the expected digest; prompt repetition duplicates the text; the manifest carries the GGUF template hash and node-llama-cpp version. It writes no history and changes no baseline.
- **Consequences**: The diagnostic needs an installed model and takes a few prompts, so it stays opt-in. It fails with exit 1 on a mismatch, while the benchmark suite and baseline hashes remain untouched.

### ADR-013: Add OpenAI text completions without changing chat behavior
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The OpenAI-compatible surface exposed models and chat completions only. LM Studio-style clients and simple prompt tools often call `/v1/completions`, which needs raw continuation rather than a chat template.
- **Decision**: Add `LlamaEngine.complete()` using `LlamaCompletion` with a fresh context sequence, the same one-generation guard, sampling settings, abort handling and manifest builder as chat. Add `POST /v1/completions` with non-streaming and SSE `text_completion` responses, single-string prompt validation, usage, finish reason and `system_fingerprint`. Chat remains on `LlamaChatSession`.
- **Consequences**: Clients can use either OpenAI endpoint; completions still enter the same CPU queue and cannot overlap a chat. The completion manifest has no system prompt or history, so it records empty values plus the prompt/settings/model identity. Prompt arrays and token-ID arrays are rejected with an actionable error rather than silently misread.

### ADR-014: Preserve actionable generation errors
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Chat and text completion wrapped every thrown error in a generic generation failure, so a deliberate 413 context overflow or invalid-schema error reached clients as a 500. A failed LlamaCompletion constructor could also leave its context sequence undisposed.
- **Decision**: Move the generation error mapping into `src/generation-error.js`. It returns an existing AppError unchanged and only wraps unexpected failures as 500 or 507 memory errors. `engine.chat` and `engine.complete` use it. If completion construction fails before the completion object exists, dispose the context sequence explicitly.
- **Consequences**: API and SSE clients receive the original status, code, why and fix for actionable failures. Generic runtime failures keep the friendly message. Sequence memory is released on the constructor-failure path.

### ADR-015: Single-model lookup and cached model listing
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: OpenAI clients expect `GET /v1/models/{id}`, and the list route rescanned the model folder on every request even though the registry already keeps a scan cache.
- **Decision**: Serve `/v1/models` from `registry.listPublic()`, add `GET /v1/models/{id}` with id or file-name lookup and a 404 for unknown models, and return quant, size and chat-template hash alongside the standard OpenAI model fields.
- **Consequences**: Model listing no longer touches disk on each request; a new model becomes visible after the normal registry refresh. Single-model lookups are cheap and unknown ids fail cleanly.

### ADR-016: Release idle chat sequences before a completion
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: With the default `sequences=1`, a lingering UI chat session owns the only context sequence. A following `/v1/completions` request failed with "No sequences left", even though generation is serialized.
- **Decision**: Before allocating a completion sequence, if `context.sequencesLeft` is zero, dispose idle chat sessions. A completion has no chat history to preserve, and the next chat turn rebuilds its session from the atomic store.
- **Consequences**: Completions and chat can alternate with the default single sequence. Alternating endpoints loses the chat KV cache; the generation manifest remains exact because the rebuilt session uses the same bounded history.

### ADR-017: Unify load and generation error mapping
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: ADR-014 preserved actionable generation errors, but model loading still wrapped GPU-backend and configuration AppErrors as generic model_load_failed 500s. Keeping two separate mappers also risked the same divergence.
- **Decision**: Rename the mapper module to `src/engine-errors.js` and expose `toLoadError` alongside `toGenerationError`. Both return an existing AppError unchanged and only wrap unexpected failures into the friendly 500/507 messages for their operation.
- **Consequences**: Explicit GPU-backend failures keep `gpu_backend_failed`, memory failures keep 507 codes, and unexpected load/generation failures stay friendly. The old `generation-error.js` was removed; ADR-014 remains as the historical generation-only decision.

### ADR-018: Refuse cross-site and rebound requests; exposure needs authentication
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: IDEA-1054. A live probe showed that with Enable CORS on, any web page in the host's browser could read server settings and mint a readable API key even with Require Authentication on, because `/api/*` trusts loopback sockets and CORS applied to every route. LAN mode skipped the Origin and Host checks, so cross-site text/plain POSTs and DNS-rebound pages reached `/api/*`. Settings accepted LAN or CORS with authentication off.
- **Decision**: `isCrossSiteRequest` refuses any request whose Origin differs from its Host (`403 cross_site_refused`), except `/v1/*` while CORS is on; CORS headers and preflight apply to `/v1/*` only. A loopback socket must always name a loopback Host; only LAN mode admits other machines. `ServerSettingsStore.update` refuses LAN or CORS without Require Authentication (`400 auth_required_for_exposure`), and `load` switches such a saved file's LAN and CORS off with a warning and saves it.
- **Consequences**: The same-origin UI (loopback or LAN) and Origin-less API clients are unchanged. Local pages on another port can no longer call ModelDuck unless CORS is on with a key. Contract change: the tests `server settings clamp values...` and `CORS preflight is answered only when enabled` now enable authentication alongside CORS, because CORS without it is no longer a valid setting.

### ADR-019: Bound the GGUF header before parsing; one download per model
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: IDEA-967 and IDEA-882. A live probe showed that node-llama-cpp 3.22.2's `readGgufFileInfo`, which every scan runs (including at startup), trusts header counts: a 100-byte file claiming 2^62 tensors exhausts the heap and one claiming 2^62 metadata entries never returns, so one planted `.gguf` would crash every launch. Separately, `DownloadManager.start` accepted a second job for a model already downloading; both appended to one `.part` file and a double-size file was promoted as complete.
- **Decision**: `src/gguf-guard.js` walks the v2/v3 header with buffered reads before the parser runs, refusing any count or length larger than the remaining file, unknown value types, nested arrays, tensors outside 1-4 dimensions and offsets past the end (`422 gguf_header_rejected`). The registry lists such files as `blocked` with the reason; the engine refuses to load them and import deletes the copy and refuses. `start` returns the existing active job for the same catalog id, and the UI disables the Download button during its request.
- **Consequences**: The guard costs about as much as the metadata parse it precedes (107 ms for a 151k-token vocabulary) and runs only on a scan-cache miss; four real GGUF models (Qwen2.5, nomic-embed, moondream2 text and projector) pass it. Arrays of arrays are refused, matching every known GGUF writer. A repeated download request is idempotent instead of corrupting the model.

### ADR-020: Archive chats past the limit instead of dropping them
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: IDEA-1047. `ChatStore` capped conversations at 200 by insertion order on load (`slice`) and on create (`length = 200`). A live probe showed chat 201 deleting the oldest-created chat even when it was used that day, and loading a 250-chat file dropping 50, including the most recently used. The cap exists because `chats.json` is rewritten on every message.
- **Decision**: Keep the 200 most recently used chats in `chats.json` and move the rest to `chats.archive.json`, which is written only when the archive changes and always before `chats.json`; on load a chat found in both files keeps its active copy. `restore(id)` moves an archived chat back (counting as used now) and archives the next least recent. `GET /api/conversations` adds `archived`, `/api/state` adds `archivedConversations`, opening an archived chat restores it, and delete reaches archived chats. The sidebar lists them under an Archived group, searchable like the rest.
- **Consequences**: No chat is lost to the cap and the per-message write stays bounded. The archive grows with history and is loaded into memory at startup; a very large archive would call for paging (out of scope). An interrupted save can at worst duplicate a chat, which load removes.

### ADR-021: No on-demand runtime build, stalled-download watchdog, pre-load memory fit
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The analysis of the research reports (IDEA-1061, 1063, 853, 903) found four gaps:
  - `getLlama()` was called without `build`, so node-llama-cpp's default `"auto"` could download and compile llama.cpp when no prebuilt binary fits. The README promised that "everything stays on your computer".
  - A download that stopped sending data stayed "downloading" forever and held one of the two slots.
  - A load that did not fit either pushed the machine into swap or silently retried smaller contexts.
  - Three README sentences claimed more than the code enforces.
- **Decision**:
  - Both `getLlama` calls pass `build: "never"`. A missing binary becomes `runtime_binary_missing`, whose fix names the explicit `npx node-llama-cpp source download` step. The runtime loader is injectable for tests.
  - `DownloadManager` aborts a job after `idleTimeoutMs` (60 s) without data and reports it as **stalled**, keeping the `.part` file for resume.
  - `src/memory-fit.js` estimates weights + KV (2 × layers × KV heads × head size × bytes per element × context) + a 256 MiB reserve. The KV shape comes from GGUF metadata, which the registry now records as `kvShape`.
  - The engine compares the estimate with free RAM plus the currently loaded model. Above 75 % it refuses with `507 model_will_not_fit` and the largest context that fits. `force` (the UI's **Load anyway**) overrides the refusal. GPU offload and unknown shapes are never refused.
  - The loaded state carries `fit` and `contextFallback` ({requested, actual, reason}), and the UI raises a toast for a reduced context or a tight fit.
  - The README now scopes its network, benchmark and preset-trust claims.
- **Consequences**:
  - A real Qwen2.5-1.5B Q4 model loads with `build: "never"` from the installed prebuilt binary, and its metadata yields the expected 28 KiB per token of F16 KV.
  - The estimate is not yet calibrated against measured peak RSS (brief 2's ±15 % gate). With mmap, part of the weights is evictable, which is why the user can override the refusal.
  - The refusal now covers the case where Windows `os.freemem()` is low and the machine would swap.

### ADR-022: Public benchmark items, live runs and data-driven recommendations
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: IDEA-1037 and the user's request for public benchmark items, visible optimal configurations and live progress. The private suite measured code, comprehension, recall and facts but had no external reference points; the Bench panel was read-only; presets were hand-picked and a speed-only variant could be suggested without proving it kept the base model's answers.
- **Decision**:
  - Suite v6 adds 34 items from permissively licensed datasets (GSM8K, MMLU, HumanEval, MBPP, TruthfulQA), each with `source.dataset`, `source.id` and `source.license`, plus `NOTICE-benchmarks.md`. HumanEval and MBPP are translated to JavaScript and keep their original cases; public categories are reported separately.
  - `benchmarks/recommend.mjs` ranks full-suite variants for best quality, best overall (70 % quality + 30 % speed within 15 points), best coding (`code`, `bugfix`, `public-code`) and fastest within a 5-point loss. Speed is normalised only over variants that clear the quality floor, so a fast but poor model cannot distort the balance.
  - Results separate **own questions** from **public benchmark items** by origin (`items.byOrigin`), derived from the prompt category/source so older results remain readable without changing the test hash. The overall rate still includes both.
  - A model-phase variant can be saved to `benchmarks/chat-base.json` (`POST /api/benchmarks/base`, **Use for chat**, or `--select-base`). The next chat phase builds its fixed sampling matrix on that measured model, quantization, KV cache, context and reload settings; `--base-variant` uses one for a single run without saving.
  - `run.mjs --events` writes JSON progress lines on stdout and human logs on stderr. `src/benchmark-runner.js` owns one child process and exposes start, status, cancel and dispose; `src/server.js` adds loopback-only run/status/cancel routes that refuse while a reply is generating.
  - The Bench panel starts either phase, polls progress and renders recommendation cards whose **Fill settings** action only fills the form. `results/latest-<phase>.json` preserves the latest run of each phase for advice.
  - `npm run bench` runs only the required model phase on the three core models (SmolLM2 135M, Qwen2.5 0.5B, Qwen2.5 Coder 1.5B). `--full-matrix` / `bench:full` adds Qwen2.5 1.5B, Llama 3B and Phi 3.8B; `bench:all` adds the optional model-usage phase, needed only when sampling or prompting changes. `bench:update:model` replaces the model baseline alone.
  - Baselines change only through `--update-baseline` or the explicit checkbox; the app never replaces them automatically.
- **Consequences**: Suite v6 has a new test hash, so the existing v4 baseline is not comparable until both phases are deliberately rerun. Public items may be contaminated by training data, so their categories never feed the overall quality claim and are reported as a separate origin. The default gate covers three models; a six-model baseline needs `--full-matrix` and is deliberately a different test hash. One benchmark runs at a time and its child is stopped on cancel or app shutdown. Recommendations describe measured settings for the named model file; they do not load a model or prove a preset passed outside the measured matrix. A model-only baseline update leaves the chat baseline on its previous suite; `bench:all` is required before treating both phases as one comparable gate. Selecting a different chat base changes the chat test hash, and the chat run refuses with an actionable error when the selected model file is not installed.

### ADR-023: Expose checkpoint interval and max instead of only on/off
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The settings and benchmark exposed only `checkpoints: true|false`. node-llama-cpp also takes `checkpoints.interval` (default 8192 tokens) and `checkpoints.max` (default 32). At the benchmark's 2048-token context the default interval never fires, so the old on/off variants did not actually compare checkpoint reuse.
- **Decision**: Add `checkpointInterval` (128–32768 tokens, default 8192) and `checkpointMax` (1–64, default 32) to settings, the Settings panel, `LlamaEngine.load`, state, recommendation settings and the saved chat base. Both chat and completion sequences pass `{ max, interval }` to `getSequence`. Suite v7 adds `ckpt-512`, `ckpt-2048` and `ckpt-max4` smoke variants on Qwen2.5 0.5B, keeping `no-checkpoints` as the off baseline.
- **Consequences**: A smaller interval and a larger max cost memory but reuse more prefix state; the v7 core baseline measures the trade-off. The test hash changes, so the v6 model baseline is replaced deliberately. Old settings files normalize to the defaults, and loading a chat base without the new fields uses the same defaults.

### ADR-024: Single-model diagnostic runs never replace the baseline
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The core matrix takes about 33 minutes on this CPU even after the three-model default. Checking one installed model should be possible without waiting for the whole gate or shrinking the shared baseline.
- **Decision**: `--model <catalogId>` (and the Bench panel's **Single model** selector) keeps only variants from that model family, writes `results/latest-single-model.json`, and records a normal history entry with `matrixScope: single:<catalogId>`. It does not read, compare or replace `baseline-model.json`; `--update-baseline` is refused and `--full-matrix` cannot be combined with it. The Bench report renders the last diagnostic as its own phase with the same type/origin/test tables.
- **Consequences**: A one-model run is a diagnostic, not a gate; its test hash is scoped to the filtered matrix and is not compared to the shared baseline. The panel can show the last core baseline, the optional chat baseline and one diagnostic side by side. Choosing a model that has only a base variant runs just that variant.

### ADR-025: Last-number math checks, larger public set and per-dataset results
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Every GSM8K item scored 0% while several replies contained the final value, and one reply that wrote working was parsed as its first number. The `number` check took the first numeric token, and `maxTokens: 24` cut reasoning off before the answer. The public set was also small (8 GSM8K, 8 MMLU, 6 TruthfulQA, 12 code), so a dataset could not be read separately from its category.
- **Decision**: `number` checks now take the **last** numeric token after stripping thousands separators, and GSM8K prompts ask for reasoning followed by `Answer: <number>` with 512 tokens instead of forcing a one-shot 24-token answer. Suite v8 grows to 130 items: 70 own and 60 public (GSM8K 16, MMLU 12, TruthfulQA 12, HumanEval 12, MBPP 8), with extra own items in every category. Results record `items.byDataset` from each prompt's `source.dataset`, and the Bench panel shows a public-dataset table plus a dataset column in the per-test table. Public code and bug-fix test cases are still original checks; float cases are chosen to compare exactly in JavaScript.
- **Consequences**: A model that writes working and ends with the answer is no longer failed for its first intermediate number; a model that only writes a wrong final number still fails. The larger suite makes the core run longer (130 items instead of 91), while the 16-item smoke subset stays fast. The v8 test hash replaces the v7 baseline deliberately. Public per-dataset rates remain marked as possibly contaminated by training data and are not mixed into the own-question rate.

### ADR-026: Single-model runs optimise settings on the smoke set, not model quality
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: ADR-024 ran one model's existing matrix variants as a quality diagnostic. That missed the point: the user wants a quick way to find the best loading settings for one chosen model, including models such as Qwen Coder that had only a base variant in the shared matrix. Running all 130 items for 17 settings would also take as long as the core gate.
- **Decision**: `--model <catalogId>` builds a 17-variant sweep for that model (base, Q8/Q4 KV, 4k/8k context, 4/16 threads, batch 128/256/1024, flash on/off, mmap on/off, checkpoints off, checkpoint every 512, and 512/max 4), and forces the 16-item smoke set on every variant. The result is a settings recommendation for that model, written to `results/latest-single-model.json`; the Bench panel labels it **Single-model settings** and shows the model-specific advice cards. It never reads or replaces the shared baseline.
- **Consequences**: A single-model optimisation takes a few minutes and works for any installed benchmark model, including one without shared variants. Its quality comparison is a 16-item smoke signal, not a full quality verdict; the core/full matrix remains the quality gate. The chat base can be selected from the resulting recommendation as before.

### ADR-027: ModelDuck optimises settings per model and task; cross-model comparison is optional
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The benchmark grew into a cross-model quality ranking (core and full matrices, a shared baseline, a ~45-minute v8 gate). The user's goal is different: for the model they chose, find the settings that work best for each kind of task and use them. ADR-026's single-model sweep was the first step but changed one setting at a time, never tuned sampling, gave one answer per model and applied nothing.
- **Decision**: A **tune** produces a per-model profile with one load configuration and four task presets: **chat**, **code**, **math** and **recall**. Stage 1 tries load settings one at a time on a mixed subset, keeps those that are faster or lighter without losing an item, then verifies their combination; context is sized for the recall task. Stage 2 searches sampling settings (temperature, top-p, top-k, min-p, repeat penalty, token budget) per task on that task's fixed subset, seeding non-zero temperatures three times, and picks the best pass rate, then the fastest within tolerance. Profiles are stored per model, carry the hardware, runtime and suite hash, and are marked stale when any changes; a measured profile is applied when its model loads (G-004). Guidelines G-001, G-003 and G-005 are rewritten by the user's instruction: the gate becomes the tune of the three core models against their stored profiles, and the cross-model matrix becomes the optional `bench:compare`. The user stopped the v8 cross-model baseline run; suite v8 lands without a v8 cross-model baseline, which may now lag.
- **Consequences**: Switching task in chat changes sampling only and never reloads the model. Until `tune:gate` exists (task-tuner-v1, milestone 5), `npm test` is the only gate and generation changes note that the tune gate is pending. `baseline-model.json` stays at v7 as an optional reference.

### ADR-028: Tuned profiles are reused; a changed test warns instead of re-tuning
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: A full tune takes tens of minutes on a CPU. The user asked that tune statistics be saved for later use, that models not be re-tuned again and again, and that a change to the test be reported with a warning.
- **Decision**: `npm run tune` (and a `tune` job from the app) first reads the saved profile. When it covers every requested task the tune is skipped. When a fresh profile lacks some tasks, only those are tuned on its saved load config and merged in, with their sweeps and run counts added. A profile whose fingerprint differs (suite version, task-item hash, node-llama-cpp version, CPU, thread count, platform, architecture, model file or size) is still used, and `GET /api/profiles/:id` and the CLI report one plain-language warning per change, such as "The test suite changed (v8 → v9)". Mixing new tasks into a stale profile is refused; `--force` (`force: true`) re-tunes every task and replaces the profile. The load stage answers with each item's own token budget until sampling is tuned, and every candidate emits a progress event with its rate and latency.
- **Consequences**: A model is tuned once per machine, runtime and test version unless the user asks again. A suite bump no longer silently invalidates presets; it surfaces as a warning and a re-tune suggestion. Statistics accumulate in the profile file across partial tunes.

### ADR-029: The user chooses the tune steps; impossible and failed settings never win
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: The user wants to decide which values each setting is tried at. A full combination grid of the fine steps would take months to years on a CPU, so the user chose the setting-by-setting search (try every value of A, keep the best, then B, …) with their own Stage 1 steps. llama.cpp refuses a quantized V cache without flash attention (`llama-context.cpp`), and node-llama-cpp marks custom KV cache types as experimental and able to fail. Checkpoints are only taken for recurrent, hybrid or sliding-window models (node-llama-cpp `LlamaContext` docs), so they cannot change a single-turn test on the current models.
- **Decision**: Stage 1 defaults are the user's steps: context 2048/4096/8192/16384, KV f16/q8_0/q4_0, flash on/off, mmap on/off, batch 64–2048, threads 1/2/4/6/8/10/12 capped at three quarters of the logical threads. Checkpointing is an optional axis, off by default. Steps live in `~/.modelduck/tune-grid.json`, edited through `GET/PUT /api/tune/steps`, `npm run tune -- --interactive` or `--grid <file>`; values outside the settings ranges are dropped and reported rather than clamped. A quantized KV cache with flash off is skipped and listed, a load that fails marks every item failed with its reason, and a candidate whose answers all failed can never be chosen. Every tune prints an estimate first and records the steps it used in the profile.
- **Consequences**: A Stage 1 pass is 24 configurations (about 40–70 minutes on SmolLM2); Stage 2 still uses the original fine sampling steps until the user changes them and dominates the tune time. Profiles show which steps produced them.

### ADR-030: A tune runs quality → speed → sampling → prompt, and every finished step applies on its own
- **Date**: 2026-10-30
- **Status**: Accepted
- **Context**: Threads, batch size, flash attention and mmap change how fast llama.cpp answers, not what it answers, so measuring them on 24 quality questions each wasted most of Stage 1. The user ordered the work as quality, then speed, then prompting; chose the sampling steps; asked for 21 one-sentence system prompts to be tried, unselected, on every benchmark, plus reasoning off/on and prompt repetition; and asked to stop after any step and use what was found with defaults for the rest.
- **Decision**: Stage 1 (quality) tunes context and KV cache on the mixed quality rungs. Stage 2 (speed) tunes flash attention, mmap, batch, threads and optional checkpointing on a fixed six-item workload with greedy answers; a candidate whose answer text (digest) differs from the stage's start is excluded, and it yields a Fastest preset and a Light preset that uses at most half the logical threads (setting `speedPreset`). Stage 3 (sampling) tunes temperature 0–1 by 0.2, token budget 64–2048, repeat penalty 1.0–1.2, min-p 0–0.2, top-p 0.8–1.0 and top-k off/20/40 per task, skipping min-p, top-p and top-k when temperature is 0 because they cannot change a greedy answer. Stage 4 (prompt) gives every system prompt (the suite prompt plus the user's 21) a full score on each task's whole set, then tunes reasoning off/auto and promptRepeat 1/2. Stages 3–4 break quality ties on answer length in tokens; stages 1–2 on paired latency. Tunes start at three quarters of the logical threads at most. The profile is saved after every finished axis with its progress and stage status, stores only tuned keys, and `--stages` (or `stages` in the API) runs a subset; a later run resumes at the next unfinished axis. A task's tuned system prompt replaces the user's in chat while tuned settings are on.
- **Consequences**: Stopping a tune at any point leaves a usable profile; untuned settings keep their defaults. A full SmolLM2 tune is roughly 2–4.5 hours with the user's steps; repeat penalties below 1.0 stay out of range. Older profiles without progress are re-tuned from the start when continued.

### ADR-031: Stage 0 probes CPU against GPU per model before tuning
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: On this PC (i5-14400F, 16 GB RAM, Radeon RX 9060 XT 16 GB, node-llama-cpp Vulkan build installed) a one-off measurement gave SmolLM2 135M ≈154 tok/s on the CPU vs ≈46 on Vulkan, but Qwen2.5 Coder 1.5B ≈22 vs ≈124 and Phi-3.5 mini ≈9 vs ≈32. The fastest device depends on the model, and every later stage runs faster on the right one. GPU rounding can change answers, so the speed stage's identical-answers rule would always reject it.
- **Decision**: A tune now starts with a device stage: the fixed six-item speed workload, answered greedily, on the CPU (at the thread cap) and on each GPU backend in the steps (default Vulkan) with all layers offloaded; half the layers is tried only when all fail to load. A GPU is chosen only when its per-item throughput (tokens per second, which answer length does not distort) is measurably higher and it answers at least as many items correctly as the CPU; a backend that cannot start or load counts as did-not-run. The choice (`gpuBackend`, `gpuLayers`) is stored with the probe and a one-line reason, joins the profile's load settings, is applied at load, chat and JIT time, and all later stages run on it. `--stages device` answers "where does this model run fast" in about a minute. Untuned models keep the GPU off.
- **Consequences**: The first real probe kept SmolLM2 on the CPU (143 tok/s) and moved Qwen2.5 0.5B (172 vs 48 tok/s), Qwen2.5 Coder 1.5B (109 vs 20) and Phi-3.5 mini (28 tok/s; the CPU load was refused with 3.4 GB of RAM free) to Vulkan, so their tunes run several times faster. Time per answer is the wrong measure across devices because their answers differ in length; a first version that used it kept Coder 1.5B on the CPU at a fifth of the speed.

### ADR-032: The engine can answer on several sequences, but tunes answer one question at a time
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: The user asked to run benchmark questions in parallel to speed tunes up. The engine allowed one generation at a time and, before each chat, disposed every other cached session. node-llama-cpp gives a disposed sequence back to its context asynchronously, so a chat starting right after another ended could fail with "No sequences left".
- **Decision**: The engine runs up to as many generations as the model was loaded with sequences (the app loads one, so chat behaves as before), only ever disposes idle sessions, waits for every running generation on unload, and waits up to two seconds for a reclaimed sequence before failing. The tune evaluator can answer several items at once on a multi-sequence load, with the timing stages forced to one at a time. Measured on this PC, 12 tune items took 32 s one at a time on SmolLM2 (CPU) but 153 s two at a time and failed with "No sequences left" four at a time, and 3.1 s vs 2.9 s vs 3.2 s on Qwen2.5 Coder 1.5B (GPU); tunes therefore keep answering one question at a time and the option is not exposed.
- **Consequences**: No tune speedup from parallel questions on CPU or this GPU; the GPU device stage (ADR-031) is where the time is saved. The sequence-reclaim wait also protects consecutive chats. Running different models at once on different devices remains a separate idea to measure.

### ADR-033: Tunes run side by side in CPU and GPU lanes; timing stages run alone
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: Parallel questions within one model did not help (ADR-032), but different models on different devices barely slow each other: on this PC SmolLM2 on the CPU and Qwen2.5 Coder 1.5B on the GPU kept 86% and 84% of their speed together (about 1.65× the combined throughput of running them one after another), and two GPU models kept 88% and 93% (about 1.6×). Device and speed stages time answers, so other load would bias them. Other PCs have different CPUs and may have no GPU, so the lane counts must be settings.
- **Decision**: `TuneScheduler` (`POST /api/tune/start` with one model, a list or `"all"`; `GET /api/tune/status`; `POST /api/tune/cancel`) runs `tune-run` children: device probes one at a time first, then each model's remaining stages in a CPU or GPU lane chosen from its probe. Lane counts are tune settings (`lanes: { cpu: 1, gpu: 2 }` in `tune-grid.json`; CPU 1–4, GPU 0–4, where 0 sends GPU models to the CPU lane); a PC without a GPU simply probes every model onto the CPU, and `device.backends: ["cpu"]` skips GPU probing. A file-based timing lock in `<home>/tune-lanes/` makes device and speed stages exclusive: the holder waits until every other registered tune has paused between answers, the others pause before each untimed answer while it is held, and files from dead processes are ignored. `--force` goes only to a model's first run so its tune resumes from the fresh probe. A tune refuses to start beside a running reply or benchmark, and a benchmark beside a running tune.
- **Consequences**: Running all models takes roughly 1.6× less time on this PC while device and speed measurements stay free of other tunes' load. Lock and registration files live in the data folder and clean themselves up; a crashed tune's files are skipped by pid.

### ADR-034: A tune can run only chosen settings
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: Whole stages could already be chosen (`--stages`), but the user wants to run a single section, for example only the context size, or only the quality and speed settings, without redoing anything else.
- **Decision**: `--settings <names>` (API and scheduler: `settings`) runs only those settings, in stage order, each re-measured even if tuned before, on top of every other setting's current best. Valid names are listed by `settingNames()` (device, contextSize, kvCache, flashAttention, useMmap, batchSize, threads, checkpointing, temperature, maxTokens, repeatPenalty, minP, topP, topK, systemPrompt, reasoning, promptRepeat); unknown names are refused. Only settings measured now or before are stored, never untouched defaults. A partial selection never marks a stage finished; a stage finished before stays finished and its statistics are refreshed only when the stage is complete. An explicit selection always runs (no skip), still refused on a stale profile without `--force`.
- **Consequences**: Re-tuning one setting takes minutes. Light keeps its earlier thread count unless threads were re-measured. A real run re-tuning only the context size of a SmolLM2 profile swept four sizes, stored only `contextSize` and left every other stage untouched.

### ADR-035: Suite v9 adds 44 of our own coding and bug-fix questions, long ones included
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: The user asked for many more of ModelDuck's own coding and bug-fix questions, including long coding tasks and long bug fixes. The code task tuned on 24 own items, all short, with 256-token budgets.
- **Decision**: Suite v9 adds 16 coding items, 6 long coding items (`code-long`: an expression evaluator, a CSV parser, word wrap, a checkout with offers, matrix multiplication, an INI parser), 16 single-bug fixes and 6 long multi-line fixes with two or three interacting bugs (`bugfix-long`), in `benchmarks/own-items-v9.mjs`. Long items get 1024 tokens. Every case is checked against a reference solution in `tests/reference-solutions-v9.js`, and every buggy function is proven to fail its own tests (a crash counts as failing). Function names shared by two items carry the same rules; a new anagram item uses `areAnagrams` because `isAnagram` already meant something stricter. The long categories join the code task and `CODING_CATEGORIES`.
- **Consequences**: 174 items, 114 own. Saved tune profiles carry the v8 suite and task hashes, so they keep working with a "test suite changed" warning until re-tuned (ADR-028); the optional cross-model baseline lags further. Long items make the code task's tune slower per answer.

### ADR-036: The prompt stage tries one-sentence directives
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: In the first full tune of Qwen2.5 Coder 1.5B, none of the 21 thinking prompts (ADR-030) beat the suite's own format directive on any task; on long-context recall all 21 tied it. The user asked for directive-style prompts instead, and to re-run only the prompt stage.
- **Decision**: The default `systemPrompt` steps are the suite prompt followed by 21 one-sentence directives (`DIRECTIVE_PROMPTS`: answer scope, format, final-answer placement, grounding in the given text, exact function names, minimal bug fixes, edge cases), each still tried on every task, fully scored. `THINKING_PROMPTS` stays exported and a saved `tune-grid.json` keeps whatever list it holds.
- **Consequences**: Profiles tuned before keep their chosen prompt; re-running `--settings systemPrompt,reasoning,promptRepeat` measures the directives.

### ADR-037: The engine keeps the system message when it sets a session's history
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: The engine created each `LlamaChatSession` with the system prompt, then called `setChatHistory(history)` with the earlier turns. node-llama-cpp's `setChatHistory` replaces the whole history, including the system message the constructor put first, so no system prompt ever reached the model: chat, the benchmark and every tune answered under the model template's own default. A prompt-only tune of Qwen2.5 Coder 1.5B scored all 22 system prompts identically on every task, which exposed it.
- **Decision**: The engine sets the history to the session's own system items followed by the earlier turns. `tests/engine-system-prompt.test.js` mirrors node-llama-cpp's behaviour and failed before the fix; on the real model a pirate system prompt now changes the answer.
- **Consequences**: Benchmark scores and tuned prompt and sampling choices measured before this fix were measured without a system prompt; re-tune the prompt stage (`--settings systemPrompt,reasoning,promptRepeat`) or the whole profile.

### ADR-038: Suite v10 grows math and recall, adds codebase items, and tunes on 12/24/48 items
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: Tune choices rested on at most 24 items per task (recall 11, math 21), so no difference reached significance (p 0.375 to 1). The user asked for enough items for the statistics to mean something, and for a coder that works well inside complex codebases.
- **Decision**: Suite v10 adds 30 own math word problems (`reasoning`, last-number check), 40 recall items generated from a fixed seed (lookups at several depths and lengths, reverse lookups, latest status, two-balance sums, counts) and 12 codebase items in `benchmarks/repo-items-v10.mjs`: three small multi-file codebases with a distractor file each, asking for a new function on the existing helpers (`code-repo`), a fix for a reported bug (`bugfix-repo`) or the name of the function holding a bug. A `jsTests` check may carry `setup`, the codebase run before the answer, so the answer must fit it. Every answer is re-derived in `tests/benchmark-suite-v10.test.js`; every shipped bug fails and every named culprit cures its probe. `TASK_RUNGS` becomes 12/24/48.
- **Consequences**: 256 items; math and recall have 51 each, code 100, chat 54, and every task's last rung scores at least 48. A tune takes roughly twice as long per stage. Saved profiles get the suite-changed warning until re-tuned.

### ADR-039: Suite v11 adds items on three larger codebases
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: The goal is a coder that works well inside complex codebases. Suite v10 had 12 codebase items on three small projects of four or five files.
- **Decision**: `benchmarks/repo-items-v11.mjs` adds three codebases of six or seven files, each with a distractor file: a bank ledger (money, ids, accounts, rules, transfers, reports), an order and shipping service (units, stock, shipping rates, discounts, orders, dates) and a Markdown renderer (escaping, inline formatting, blocks, rendering, theme). Each gets two functions to write on the existing helpers, one reported bug to fix and one bug to locate, built with the v10 builders. `tests/benchmark-suite-v11.test.js` checks every reference answer, every shipped bug and every culprit probe.
- **Consequences**: 268 items; 24 codebase items, code task 112. Saved profiles get the suite-changed warning until re-tuned.

### ADR-040: Part runs re-measure chosen parts on top of the saved rest
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: The user wants to run one part of the tune for every model: only the CPU-versus-GPU probe, one setting, or only the prompt stage. Choosing a stage that was already done skipped it, and Run all started every stale profile over, so a prompt-only run after a suite change discarded each model's device, load and sampling results and measured prompts on defaults.
- **Decision**: A part run (some stages, or some settings, for one model or for all) measures the chosen parts again on top of the saved rest, even when they are done or the profile is stale; a partial stage resumes instead of starting over. `planTune` returns the parts it re-runs (`rerun`) and removes their progress so they start fresh; `isPartRun` is shared with the server, whose `forceStale` now starts stale profiles over only for a whole tune. A profile may carry `measuredUnder`, the fingerprint each part was measured under when they differ; `loadProfile` reports staleness across all of them, lists the old parts in `staleParts` and adds a warning naming them. This lifts ADR-034's refusal of an explicit selection on a stale profile; the test "an explicit selection of settings always runs" now expects the part run to proceed.
- **Consequences**: A device-only run of a stale Qwen2.5 Coder profile re-measured the probe under suite v11 and kept every other result, recorded as measured under the older suite. A full re-tune still needs `force` (Re-tune ⚠) on a stale profile.

### ADR-041: The prompt stage tries reasoning off and fully on
- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: The prompt stage compared reasoning `off` with `auto`, which only adds a short "reason carefully, keep it concise" nudge. The user asked for reasoning to be tuned off and on.
- **Decision**: The default `reasoning` steps are `off` and `deep` ("think through the problem carefully before giving the final answer"). `auto` stays a valid step for a saved grid.
- **Consequences**: Profiles tuned before keep their chosen reasoning; re-running `--settings reasoning` (or the prompt stage) measures the new pair.
