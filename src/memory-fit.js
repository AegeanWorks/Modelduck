/**
 * Estimates the memory a load needs before it starts, so a model that will not
 * fit is refused with a remedy instead of pushing the machine into swap. At
 * batch 1 the binding constraint on 8 GB is weights plus the KV cache, which
 * grows linearly with context: 2 (K and V) x layers x KV heads x head size x
 * bytes per element, per token.
 */

const KV_BYTES_PER_ELEMENT = Object.freeze({
  f16: 2,
  q8_0: 34 / 32, // 32 int8 values plus one f16 scale per block
  q4_0: 18 / 32, // 32 nibbles plus one f16 scale per block
});
export const RUNTIME_RESERVE_BYTES = 256 * 1024 ** 2; // compute buffers and the runtime itself
export const COMFORTABLE_RATIO = 0.6;
export const FIT_LIMIT_RATIO = 0.75;
const CONTEXT_STEP = 512;

/** Reads the KV shape from GGUF architecture metadata; null when it is incomplete. */
export function kvShapeFromMetadata(architectureMetadata) {
  const layers = Number(architectureMetadata?.block_count);
  const heads = Number(architectureMetadata?.attention?.head_count);
  const kvHeads = Number(architectureMetadata?.attention?.head_count_kv ?? heads);
  const keyLength = Number(architectureMetadata?.attention?.key_length); // aikit:allow-secret attention size
  const headDim = keyLength || Number(architectureMetadata?.embedding_length) / heads;
  const shape = { layers, kvHeads, headDim };
  return Object.values(shape).every((value) => Number.isFinite(value) && value > 0) ? shape : null;
}

export function kvBytesPerToken(shape, kvCache = "f16") {
  if (!shape) return null;
  const element = KV_BYTES_PER_ELEMENT[kvCache] ?? KV_BYTES_PER_ELEMENT.f16;
  return Math.ceil(2 * shape.layers * shape.kvHeads * shape.headDim * element);
}

export function estimateLoad({ modelBytes, shape, contextSize, kvCache }) {
  const perToken = kvBytesPerToken(shape, kvCache); // aikit:allow-secret KV cache size
  const kv = perToken === null ? null : perToken * contextSize;
  const weights = Number(modelBytes) || 0;
  return {
    weights,
    kv,
    overhead: RUNTIME_RESERVE_BYTES,
    total: weights + (kv ?? 0) + RUNTIME_RESERVE_BYTES,
    contextSize,
    kvCache,
  };
}

function largestContextWithin(budget, { modelBytes, shape, kvCache }) {
  const perToken = kvBytesPerToken(shape, kvCache); // aikit:allow-secret KV cache size
  const room = budget - (Number(modelBytes) || 0) - RUNTIME_RESERVE_BYTES;
  if (!perToken || room <= 0) return 0;
  return Math.floor(room / perToken / CONTEXT_STEP) * CONTEXT_STEP;
}

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

/**
 * The context size a tune uses (ADR-043): the largest of `steps` whose load fits comfortably
 * in `availableBytes` (the device's free memory) and the model was trained for. The short test
 * questions cannot tell context sizes apart, so memory decides; with nothing fitting, or the KV
 * shape unknown, the smallest step is used.
 */
export function budgetContext({ steps, modelBytes, shape, kvCache = "f16", availableBytes, trainContext = Infinity }) {
  const sizes = [...steps].map(Number).filter((size) => size > 0).sort((left, right) => left - right);
  const smallest = sizes[0];
  if (!kvBytesPerToken(shape, kvCache) || !(availableBytes > 0)) {
    return { contextSize: smallest, reason: `Free memory or the model's KV shape is unknown, so the smallest listed context (${smallest}) is used.` };
  }
  const fits = (size) => estimateLoad({ modelBytes, shape, contextSize: size, kvCache }).total <= availableBytes * COMFORTABLE_RATIO;
  const usable = sizes.filter((size) => size <= trainContext && fits(size));
  if (!usable.length) {
    return { contextSize: smallest, reason: `No listed size fits comfortably in ${gib(availableBytes)} free, so the smallest (${smallest}) is used.` };
  }
  const contextSize = usable.at(-1);
  const capped = sizes.some((size) => size > contextSize && size > trainContext && fits(size));
  return {
    contextSize,
    reason: `${contextSize} is the largest listed context that fits comfortably in ${gib(availableBytes)} free with a ${kvCache} KV cache` +
      `${capped ? `; the model was trained for ${trainContext}` : ""}.`,
  };
}

/**
 * "comfortable" under 60 % of available memory, "tight" up to 75 %, and
 * "will_not_fit" above that. "unknown" when the KV shape is missing, which
 * never blocks a load.
 */
export function fitVerdict({ estimate, availableBytes, shape = null, modelBytes = estimate?.weights, kvCache = estimate?.kvCache }) {
  if (estimate?.kv === null || !(availableBytes > 0)) {
    return { verdict: "unknown", ratio: null, availableBytes: availableBytes ?? null, largestSafeContext: null };
  }
  const ratio = estimate.total / availableBytes;
  const verdict = ratio <= COMFORTABLE_RATIO ? "comfortable" : ratio <= FIT_LIMIT_RATIO ? "tight" : "will_not_fit";
  const largestSafeContext = shape
    ? largestContextWithin(availableBytes * FIT_LIMIT_RATIO, { modelBytes, shape, kvCache })
    : null;
  return { verdict, ratio: Number(ratio.toFixed(3)), availableBytes, largestSafeContext };
}
