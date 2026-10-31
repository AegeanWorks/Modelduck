import { SYSTEM_PROMPT } from "./suite.mjs";
import { speedItems, tuneRungs } from "./tasks.mjs";

/**
 * Search spaces for a tune, as plain step lists the user can edit
 * (`~/.modelduck/tune-grid.json`, the Bench panel, `--interactive`). A tune
 * runs four stages in order (ADR-030): quality load settings, speed load
 * settings, sampling per task, prompt per task. Each axis becomes a list of
 * setting patches; a patch with several keys moves them together.
 */

const freezeDeep = (value) => {
  if (value && typeof value === "object") Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

/** The user's first one-sentence system prompts (2026-10-30); no longer a default step (ADR-036), still usable from a saved grid. */
export const THINKING_PROMPTS = freezeDeep([
  "Exercise abstract thinking.",
  "Think from first principles.",
  "Identify hidden patterns.",
  "Challenge conventional assumptions.",
  "Connect unrelated concepts.",
  "Explore counterfactual scenarios.",
  "Develop lateral thinking.",
  "Practice causal reasoning.",
  "Recognize emergent patterns.",
  "Think across multiple levels of abstraction.",
  "Question your own conclusions.",
  "Embrace ambiguity.",
  "Synthesize opposing perspectives.",
  "Generate unconventional solutions.",
  "Practice analogical reasoning.",
  "Explore multidimensional relationships.",
  "Compress complex ideas into simple principles.",
  "Think beyond established frameworks.",
  "Develop recursive reasoning.",
  "Anticipate unintended consequences.",
  "Seek connections between distant disciplines.",
]);

/** One-sentence directives a small model can act on, each tried on every task (ADR-036). */
export const DIRECTIVE_PROMPTS = freezeDeep([
  "Answer with only what the question asks for.",
  "Follow the requested output format exactly.",
  "Be concise and do not explain unless asked.",
  "Read the whole question before answering.",
  "Check your answer against the question before replying.",
  "Work through the problem step by step, then state the final answer.",
  "Put the final answer on the last line.",
  "Give numeric answers as plain numbers.",
  "Answer only from the given text, quoting it where you can.",
  "Do not invent details that are not in the question.",
  "If the given text does not contain the answer, say so.",
  "Use the exact function name and signature requested.",
  "Write complete, runnable code with no placeholders.",
  "Return only the code when asked for code.",
  "Fix only the bug and keep the rest of the code unchanged.",
  "Handle edge cases such as empty input.",
  "Do not repeat the question.",
  "Answer in one word when one word is enough.",
  "Prefer correctness over brevity.",
  "State any assumption in one short sentence before using it.",
  "Keep the names, order and formatting of the input.",
]);

const TOKEN_STEPS = [64, 128, 256, 512, 1024, 2048];

/** The user's chosen steps (2026-10-30). */
export const DEFAULT_STEPS = freezeDeep({
  // Stage 0 probes these; "cpu" is always the reference.
  device: { backends: ["cpu", "vulkan"] },
  // Tunes run side by side in lanes (ADR-033); set per PC. 0 GPU lanes runs GPU models one after another.
  lanes: { cpu: 1, gpu: 2 },
  load: {
    contextSize: [2048, 4096, 8192, 16384],
    kvCache: ["f16", "q8_0", "q4_0"],
    flashAttention: ["on", "off"],
    useMmap: ["on", "off"],
    batchSize: [64, 128, 256, 512, 1024, 2048],
    threads: [1, 2, 4, 6, 8, 10, 12],
    // Only taken for recurrent, hybrid or sliding-window models (node-llama-cpp docs); off unless switched on.
    checkpointing: { enabled: false, interval: [128, 256, 512, 1024, 2048], max: [4, 8, 16, 32] },
  },
  sampling: {
    temperature: [0, 0.2, 0.4, 0.6, 0.8, 1],
    maxTokens: { chat: TOKEN_STEPS, code: TOKEN_STEPS, math: TOKEN_STEPS, recall: TOKEN_STEPS },
    repeatPenalty: [1, 1.05, 1.1, 1.15, 1.2],
    minP: [0, 0.05, 0.1, 0.15, 0.2],
    topP: [0.8, 0.85, 0.9, 0.95, 1],
    topK: [0, 20, 40],
  },
  prompt: {
    // The prompt the earlier stages answered with comes first, as the reference.
    systemPrompt: [SYSTEM_PROMPT, ...DIRECTIVE_PROMPTS],
    // Off against fully on: "deep" asks the model to think before answering; "auto" is only a nudge.
    reasoning: ["off", "deep"],
    promptRepeat: [1, 2],
  },
});

const number = (min, max, integer = false) => (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const oneOf = (...allowed) => (value) => allowed.includes(value);

/** The ranges the settings form accepts (`normalizeSettings`); a step outside one would be silently clamped. */
const VALID = Object.freeze({
  contextSize: number(512, 32768, true),
  kvCache: oneOf("f16", "q8_0", "q4_0"),
  flashAttention: oneOf("auto", "on", "off"),
  useMmap: oneOf("auto", "on", "off"),
  batchSize: number(32, 8192, true),
  threads: number(1, 64, true),
  interval: number(128, 32768, true),
  max: number(1, 64, true),
  temperature: number(0, 2),
  maxTokens: number(16, 8192, true),
  repeatPenalty: number(1, 2),
  minP: number(0, 1),
  topP: number(0.05, 1),
  topK: number(0, 200, true),
  systemPrompt: (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 8000,
  reasoning: oneOf("off", "auto", "deep"),
  backends: oneOf("cpu", "vulkan", "cuda"),
  cpuLanes: number(1, 4, true),
  gpuLanes: number(0, 4, true),
  promptRepeat: number(1, 3, true),
});

function cleanList(name, input, fallback, check, problems) {
  if (input === undefined) return [...fallback];
  const list = Array.isArray(input) ? input : [input];
  const kept = [];
  for (const value of list) {
    const shown = typeof value === "string" && value.length > 40 ? `${value.slice(0, 40)}…` : value;
    if (!check(value)) problems.push(`${name} ${shown === "" ? "(empty)" : shown} is outside the allowed range and was dropped`);
    else if (!kept.includes(value)) kept.push(value);
  }
  if (!kept.length) {
    problems.push(`${name} had no usable steps; its defaults are used`);
    return [...fallback];
  }
  return typeof kept[0] === "number" ? kept.sort((left, right) => left - right) : kept;
}

/** Validate a user step file: unknown or out-of-range values are dropped and reported, missing axes use the defaults. */
export function normalizeSteps(input = {}) {
  const problems = [];
  const load = input?.load ?? {};
  const sampling = input?.sampling ?? {};
  const prompt = input?.prompt ?? {};
  const defaults = DEFAULT_STEPS;
  const list = (name, value, fallback, check = VALID[name]) => cleanList(name, value, fallback, check, problems);
  const checkpointing = load.checkpointing ?? {};
  const backends = list("backends", input?.device?.backends, defaults.device.backends);
  const lane = (key, check) => {
    const value = input?.lanes?.[key];
    if (value === undefined) return defaults.lanes[key];
    if (check(value)) return value;
    problems.push(`lanes.${key} ${value} is outside the allowed range; the default ${defaults.lanes[key]} is used`);
    return defaults.lanes[key];
  };
  const steps = {
    lanes: { cpu: lane("cpu", VALID.cpuLanes), gpu: lane("gpu", VALID.gpuLanes) },
    device: { backends: backends.includes("cpu") ? backends : ["cpu", ...backends] },
    load: {
      contextSize: list("contextSize", load.contextSize, defaults.load.contextSize),
      kvCache: list("kvCache", load.kvCache, defaults.load.kvCache),
      flashAttention: list("flashAttention", load.flashAttention, defaults.load.flashAttention),
      useMmap: list("useMmap", load.useMmap, defaults.load.useMmap),
      batchSize: list("batchSize", load.batchSize, defaults.load.batchSize),
      threads: list("threads", load.threads, defaults.load.threads),
      checkpointing: {
        enabled: checkpointing.enabled === true,
        interval: list("checkpointing.interval", checkpointing.interval, defaults.load.checkpointing.interval, VALID.interval),
        max: list("checkpointing.max", checkpointing.max, defaults.load.checkpointing.max, VALID.max),
      },
    },
    sampling: {
      temperature: list("temperature", sampling.temperature, defaults.sampling.temperature),
      maxTokens: Object.fromEntries(Object.entries(defaults.sampling.maxTokens).map(([task, fallback]) => [ // aikit:allow-secret token budgets
        task,
        list(`maxTokens.${task}`, sampling.maxTokens?.[task], fallback, VALID.maxTokens),
      ])),
      repeatPenalty: list("repeatPenalty", sampling.repeatPenalty, defaults.sampling.repeatPenalty),
      minP: list("minP", sampling.minP, defaults.sampling.minP),
      topP: list("topP", sampling.topP, defaults.sampling.topP),
      topK: list("topK", sampling.topK, defaults.sampling.topK),
    },
    prompt: {
      systemPrompt: list("systemPrompt", prompt.systemPrompt, defaults.prompt.systemPrompt),
      reasoning: list("reasoning", prompt.reasoning, defaults.prompt.reasoning),
      promptRepeat: list("promptRepeat", prompt.promptRepeat, defaults.prompt.promptRepeat),
    },
  };
  return { steps, problems };
}

/** Thread steps that leave a quarter of the logical threads free, so a tune never takes the whole computer. */
export function threadSteps(values, { logicalCores = 8 } = {}) {
  const cap = Math.max(1, Math.floor(logicalCores * 0.75));
  const kept = values.filter((count) => count >= 1 && count <= cap);
  return kept.length ? kept : [1];
}

/** llama.cpp refuses a quantized V cache without flash attention, and ModelDuck turns flash on for one anyway. */
export function isValidCombination(settings) {
  return !(settings.kvCache && settings.kvCache !== "f16" && settings.flashAttention === "off");
}

const axis = (name, key, values, extra = {}) =>
  Object.freeze({ name, patches: Object.freeze(values.map((value) => Object.freeze({ [key]: value }))), ...extra });

/** Stage 1: load settings that can change answers; context first so KV runs on the size recall needs. */
export function qualityAxes(steps = DEFAULT_STEPS.load) {
  // The test questions are short, so no context size answers better than another; a tune with a
  // memory budget picks the largest listed size that fits instead of measuring them (ADR-043).
  return Object.freeze([{ ...axis("contextSize", "contextSize", steps.contextSize), budget: true }, axis("kvCache", "kvCache", steps.kvCache)]);
}

/** Stage 2: load settings that only change speed, measured on a fixed workload. */
export function speedAxes(hardware = {}, steps = DEFAULT_STEPS.load) {
  const axes = [
    axis("flashAttention", "flashAttention", steps.flashAttention),
    axis("useMmap", "useMmap", steps.useMmap),
    axis("batchSize", "batchSize", steps.batchSize),
    axis("threads", "threads", threadSteps(steps.threads, hardware)),
  ];
  if (steps.checkpointing?.enabled) {
    const patches = [{ checkpoints: false }];
    for (const checkpointInterval of steps.checkpointing.interval) {
      for (const checkpointMax of steps.checkpointing.max) patches.push({ checkpoints: true, checkpointInterval, checkpointMax });
    }
    axes.push(Object.freeze({ name: "checkpointing", patches: Object.freeze(patches.map(Object.freeze)) }));
  }
  return Object.freeze(axes);
}

/**
 * Stage 3: sampling for one task. Temperature first; min-p, top-p and top-k
 * only drop unlikely tokens, so they cannot change a greedy (temperature 0) answer.
 */
export function samplingAxes(taskId, steps = DEFAULT_STEPS.sampling) {
  const noop = { greedyNoop: true };
  return Object.freeze([
    axis("temperature", "temperature", steps.temperature),
    axis("maxTokens", "maxTokens", steps.maxTokens[taskId] ?? steps.maxTokens.chat),
    axis("repeatPenalty", "repeatPenalty", steps.repeatPenalty),
    axis("minP", "minP", steps.minP, noop),
    axis("topP", "topP", steps.topP, noop),
    axis("topK", "topK", steps.topK, noop),
  ]);
}

/** Stage 4: prompt wording for one task. Every system prompt gets a full score on the task's whole set. */
export function promptAxes(steps = DEFAULT_STEPS.prompt) {
  return Object.freeze([
    axis("systemPrompt", "systemPrompt", steps.systemPrompt, { full: true }),
    axis("reasoning", "reasoning", steps.reasoning),
    axis("promptRepeat", "promptRepeat", steps.promptRepeat),
  ]);
}

/** Every setting name a tune can run on its own (`--settings`), in stage order. */
export function settingNames() {
  const load = { ...DEFAULT_STEPS.load, checkpointing: { ...DEFAULT_STEPS.load.checkpointing, enabled: true } };
  return ["device", ...qualityAxes(load), ...speedAxes({ logicalCores: 64 }, load), ...samplingAxes("chat"), ...promptAxes()].map((axis) => axis.name ?? axis);
}

/** Answers one axis costs under successive halving: every value on the first rung, the better half on each next one. */
function axisAnswers(count, rungSizes, seeds, full = false) {
  if (full) return count * rungSizes.at(-1) * seeds;
  let answers = count * rungSizes[0];
  let kept = count;
  for (let index = 1; index < rungSizes.length; index += 1) {
    kept = Math.min(kept, Math.max(2, Math.ceil(kept / 2)));
    answers += kept * (rungSizes[index] - rungSizes[index - 1]);
  }
  return answers * seeds;
}

function stageCost(axes, sizes, seeds, secondsPerAnswer, reloadSeconds = 0) {
  const entry = { configs: 0, answers: 0, seconds: 0 };
  for (const { patches, full } of axes) {
    const answers = axisAnswers(patches.length, sizes, seeds, full);
    entry.configs += patches.length;
    entry.answers += answers;
    entry.seconds += answers * secondsPerAnswer + patches.length * reloadSeconds;
  }
  return entry;
}

/**
 * Rough cost of one coordinate-descent pass, before a tune starts. Sampling
 * and prompt stages count every seed and every axis, so they are upper bounds;
 * a second pass only runs when the first changed something.
 */
export function estimateTune(steps, { logicalCores = 8, tasks = ["chat", "code", "math", "recall"], secondsPerAnswer = 3, reloadSeconds = 5, seeds = 3 } = {}) {
  const rungs = tuneRungs(tasks);
  const device = stageCost([{ patches: steps.device.backends }], [speedItems().length], 1, secondsPerAnswer, reloadSeconds);
  const quality = stageCost(qualityAxes(steps.load), rungs.load.map((rung) => rung.length), 1, secondsPerAnswer, 2 * reloadSeconds);
  const speed = stageCost(speedAxes({ logicalCores }, steps.load), [speedItems().length], 1, secondsPerAnswer, reloadSeconds);
  const sampling = {};
  const prompt = {};
  for (const task of tasks) {
    const sizes = rungs[task].map((rung) => rung.length);
    sampling[task] = stageCost(samplingAxes(task, steps.sampling), sizes, seeds, secondsPerAnswer);
    prompt[task] = stageCost(promptAxes(steps.prompt), sizes, seeds, secondsPerAnswer);
  }
  const perTask = (entries) => Object.values(entries).reduce((sum, entry) => sum + entry.seconds, 0);
  const onePassSeconds = Math.round(device.seconds + quality.seconds + speed.seconds + perTask(sampling) + perTask(prompt));
  return { device, quality, speed, sampling, prompt, onePassSeconds, worstCaseSeconds: onePassSeconds * 2 };
}
