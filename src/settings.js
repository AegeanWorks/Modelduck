import { DEFAULT_SETTINGS, normalizeSettings } from "./config.js";
import { readJsonWithQuarantine, writeJsonAtomic } from "./fs-atomic.js";

export class SettingsStore {
  #value;
  #file;
  #logger;

  constructor({ file, logger = console }) {
    this.#file = file;
    this.#logger = logger;
    this.#value = { ...DEFAULT_SETTINGS };
  }

  get value() {
    return { ...this.#value };
  }

  async load() {
    const data = await readJsonWithQuarantine(this.#file, null, { logger: this.#logger });
    const raw = data && typeof data === "object" && data.settings ? data.settings : data;
    this.#value = normalizeSettings(raw ?? {});
    return this.value;
  }

  async update(patch) {
    const next = normalizeSettings({ ...this.#value, ...(patch ?? {}) });
    await writeJsonAtomic(this.#file, { version: 1, settings: next });
    this.#value = next;
    return this.value;
  }
}
