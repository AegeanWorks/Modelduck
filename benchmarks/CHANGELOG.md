# Benchmark test changelog

The test definitions are versioned separately from the application and from the
model settings. Every run records `suiteVersion` and a SHA-256 `testHash` of the
prompts, checks and matrix entries. If those definitions change, the hash changes
and the baseline must be updated deliberately; a result delta is then visibly a
test change, not a model/settings regression.

| Version | Date | Change |
|---|---|---|
| v1 | 2026-10-30 | Initial 9 tasks: exact word, arithmetic, factual, reasoning, JSON, JavaScript, lowercase, list, needle. |
| v2 | 2026-10-30 | Added HellaSwag-style choice, MMLU-style choice, GSM8K-style word problem, reading comprehension and bug-fix tasks. |
| v3 | 2026-10-30 | Split into model-reload and chat-usage phases; added quantization, KV cache, context/batch/thread/sequence/flash/mmap/checkpoint variants and sampling/system/reasoning/prompt-repeat/structured-output variants. |
| v4 | 2026-10-30 | Hash the global and per-variant system prompts, `promptIds`, effective sampling defaults and the generation-manifest version. Every run also records node-llama-cpp/Node versions, model chat-template hashes and a per-generation manifest digest; a runtime, model-file size or chat-template mismatch is refused like a test-hash mismatch. |
| v5 | 2026-10-30 | 57 items (was 14): 10 executable coding tasks and 8 bug fixes run against test cases in a `node --permission` sandbox (one check per case), 8 comprehension items (inference, negation, time arithmetic, abstention), 7 in-context recall items (lookups at start/middle/end, two needles, latest value wins), 10 fact-recall items. Speed-only variants run a 14-item cross-family smoke subset (matrix v3). The gate is now paired per item: Wilson CIs, exact McNemar per variant with Holm correction, fail only on a 5-pt item-rate floor or a significant decline. |
| v6 | 2026-10-30 | 91 items (was 57): 34 items from permissively licensed public benchmarks with per-item source/licence metadata and a NOTICE — GSM8K (8), MMLU (8), HumanEval translated to JavaScript (8), MBPP translated to JavaScript (4) and TruthfulQA (6). Public categories are reported separately because models may have seen them, and the report also splits own questions from public items by origin. The smoke subset grows to 16 items. The model phase now defaults to the three core models (SmolLM2 135M, Qwen2.5 0.5B, Qwen2.5 Coder 1.5B); `--full-matrix` adds Llama 3B and Phi 3.8B. The app can start either phase, stream JSON progress, and show recommendation cards; `results/latest-<phase>.json` keeps the last run of each phase. `npm run bench` now runs the required model phase only; `bench:all` adds the optional model-usage phase. A model-phase variant can be saved to `chat-base.json` and used by a later chat run; matrix v4 builds the chat variants on that selected base. |
| v7 | 2026-10-30 | Adds checkpoint **interval** and **max** as first-class parameters instead of only on/off: `checkpointInterval` (tokens between checkpoints) and `checkpointMax` (states kept per sequence). Core matrix gains `ckpt-512`, `ckpt-2048` and `ckpt-max4` smoke variants; the settings panel exposes both, the engine passes them to `getSequence`, and recommendations/chat bases carry them. Test hash changes, so the model baseline must be replaced deliberately. |
| v9 | 2026-10-31 | 174 items (was 130): 44 new own items — 16 coding, 6 long coding (`code-long`, 1024 tokens), 16 bug fixes and 6 long multi-bug fixes (`bugfix-long`, 1024 tokens). Every case is checked against a reference solution and every buggy function is proven to fail its own tests. The long categories join the code task and the coding rate. Test hash and task-subset hash change, so saved tune profiles show a suite-changed warning until re-tuned. |
| v10 | 2026-10-31 | 256 items (was 174): 30 own math word problems, 40 generated recall items and 12 multi-file codebase items (`code-repo`, `bugfix-repo`: write a function on the existing helpers, fix a reported bug, name the function holding a bug). A `jsTests` check can carry `setup`, the codebase loaded before the answer. Math and recall reach 51 items each; tuning rungs grow from 6/12/24 to 12/24/48. Test and task-subset hashes change, so saved tune profiles show a suite-changed warning until re-tuned. |
| v11 | 2026-10-31 | 268 items (was 256): 12 items on three larger codebases with six or seven files each (a bank ledger, an order and shipping service, a Markdown renderer): six functions to write, three reported bugs to fix, three bugs to locate. The code task grows to 112 items. Test and task-subset hashes change, so saved tune profiles show a suite-changed warning until re-tuned. |
| v8 | 2026-10-30 | 130 items (was 91): own questions grow to 70 (instruction, reasoning, knowledge, format, code, bugfix, comprehension, recall, facts and context each gain items) and public items to 60 — GSM8K 16, MMLU 12, TruthfulQA 12, HumanEval 12 and MBPP 8. The number check now reads the **last** number in the reply (GSM8K answers often follow working), and math prompts get 512 tokens and an explicit "Answer: <number>" ending so a model is not cut off mid-reasoning. Public items also expose a per-dataset breakdown. Test hash changes; replace the baseline deliberately. |

When adding or changing a prompt, check or matrix variant:

1. Bump `SUITE_VERSION` in `benchmarks/suite.mjs`.
2. Add a row to this table.
3. Run both phases with `--update-baseline` deliberately.
4. Do not claim a quality gain until the new baseline and test hash are committed.
