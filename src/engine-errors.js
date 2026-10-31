import { AppError } from "./errors.js";

/**
 * Preserve errors that already carry a status/code/fix. Only wrap unexpected
 * failures into the friendly message for the operation that failed.
 */
export function toGenerationError(error) {
  if (error instanceof AppError) return error;
  const message = String(error?.message || error);
  if (/memory|alloc|oom/i.test(message)) {
    return new AppError("The model ran out of memory", {
      code: "generation_out_of_memory",
      status: 507,
      why: "The context or model needed more RAM while generating this reply.",
      fix: "Stop other apps, lower the context size, or start a new chat with a smaller model.",
    });
  }
  return new AppError("The model stopped generating", {
    code: "generation_failed",
    status: 500,
    why: message.slice(0, 400),
    fix: "Try again, or unload and reload the model if the problem persists.",
  });
}

export function toLoadError(error) {
  if (error instanceof AppError) return error;
  const message = String(error?.message || error);
  if (/memory|alloc|oom/i.test(message)) {
    return new AppError("The model did not fit in memory", {
      code: "model_out_of_memory",
      status: 507,
      why: "There was not enough free RAM to load the model and its context.",
      fix: "Unload other apps, lower the context size in Settings, or choose a smaller model.",
    });
  }
  return new AppError("The model could not be loaded", {
    code: "model_load_failed",
    status: 500,
    why: message.slice(0, 300),
    fix: "Try a different GGUF file, lower the context size, or set KV cache to F16 in Settings.",
  });
}
