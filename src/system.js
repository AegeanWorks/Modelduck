import os from "node:os";

import { APP_NAME, VERSION } from "./config.js";

export function systemInfo() {
  const cpus = os.cpus();
  return {
    app: APP_NAME,
    version: VERSION,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: cpus[0]?.model?.trim() || "unknown CPU",
    cores: cpus.length,
    parallelism:
      typeof os.availableParallelism === "function" ? os.availableParallelism() : cpus.length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: process.uptime(),
  };
}
