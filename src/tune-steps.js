import { normalizeSteps } from "../benchmarks/tune-grid.mjs";
import { readJsonWithQuarantine, writeJsonAtomic } from "./fs-atomic.js";

/**
 * The user's tune steps (`~/.modelduck/tune-grid.json`). A missing file means
 * the defaults; a saved file is always stored in its cleaned form.
 */
export async function readSteps(file) {
  const raw = await readJsonWithQuarantine(file, null);
  return { ...normalizeSteps(raw ?? {}), custom: raw !== null };
}

export async function writeSteps(file, input) {
  const { steps, problems } = normalizeSteps(input);
  await writeJsonAtomic(file, steps);
  return { steps, problems, custom: true };
}
