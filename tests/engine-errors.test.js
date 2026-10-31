import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../src/errors.js";
import { toGenerationError, toLoadError } from "../src/engine-errors.js";

test("actionable generation errors keep their status, code and fix", () => {
  const original = new AppError("The context is full", {
    code: "context_overflow",
    status: 413,
    why: "The prompt does not fit.",
    fix: "Shorten the prompt.",
  });
  assert.equal(toGenerationError(original), original);
  assert.equal(original.status, 413);
  assert.equal(original.code, "context_overflow");
});

test("memory generation failures become a 507 memory error", () => {
  const error = toGenerationError(new Error("failed to allocate graph memory"));
  assert.equal(error.status, 507);
  assert.equal(error.code, "generation_out_of_memory");
  assert.match(error.fix, /lower the context size/i);
});

test("unexpected generation failures become a friendly error", () => {
  const error = toGenerationError(new Error("unexpected tensor shape"));
  assert.equal(error.status, 500);
  assert.equal(error.code, "generation_failed");
  assert.match(error.why, /tensor shape/);
});

test("actionable load errors are preserved", () => {
  const original = new AppError("The GPU backend could not start", {
    code: "gpu_backend_failed",
    status: 500,
    why: "Vulkan is unavailable.",
    fix: "Use the CPU backend.",
  });
  assert.equal(toLoadError(original), original);
  assert.equal(original.code, "gpu_backend_failed");
});

test("memory load failures become a 507 memory error", () => {
  const error = toLoadError(new Error("out of memory while loading tensors"));
  assert.equal(error.status, 507);
  assert.equal(error.code, "model_out_of_memory");
  assert.match(error.fix, /lower the context size/i);
});

test("unexpected load failures become a friendly error", () => {
  const error = toLoadError(new Error("invalid GGUF header"));
  assert.equal(error.status, 500);
  assert.equal(error.code, "model_load_failed");
  assert.match(error.why, /GGUF header/);
});
