import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hostname } from "node:os";
import { isCmuxAvailable, spawnInCmux } from "./cmux";
import { isGhosttyAvailable, spawnInGhostty } from "./ghostty";
import {
  cleanup,
  parseMeta,
  readTextFile,
  shellQuote,
  waitForFile,
  writeRunScript,
} from "./shared";
import type { PaneHandle, SpawnBackend, SpawnOptions, SpawnResult, SpawnWorker } from "./types";

export type {
  PaneHandle,
  PaneSpawnInput,
  SplitDirection,
  SpawnBackend,
  SpawnOptions,
  SpawnResult,
  SpawnWorker,
} from "./types";
export { isCmuxAvailable } from "./cmux";
export { isGhosttyAvailable } from "./ghostty";

const DEFAULT_TIMEOUT_MS = 600_000;

// Factory entry point required by pi extension auto-discovery. Every
// `extensions/*.ts` and `extensions/*/index.ts` file is loaded as an extension,
// so this module needs one even though the commands register elsewhere.
export default function (_pi: ExtensionAPI) {
  // no-op
}

/** Pick the first backend whose environment checks pass, falling back to headless. */
async function selectBackend(pi: ExtensionAPI): Promise<SpawnBackend> {
  if (isCmuxAvailable()) return "cmux";
  if (await isGhosttyAvailable(pi)) return "ghostty";
  return "headless";
}

export async function hasVisibleTerminal(pi: ExtensionAPI): Promise<boolean> {
  return (await selectBackend(pi)) !== "headless";
}

async function readWorkerPid(pidFile: string): Promise<number | undefined> {
  const value = Number.parseInt(await readTextFile(pidFile), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function terminateWorker(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Worker ${pid} remains alive after SIGTERM`);
}

/**
 * Run a sub-agent in a visible terminal pane when available, with optional headless fallback. Code-writing feature steps set `requireTerminal` so every worker owns a pane.
 */
export async function runSubagent(pi: ExtensionAPI, options: SpawnOptions): Promise<SpawnResult> {
  const cwd = options.cwd ?? options.ctx.cwd;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const direction = options.direction ?? "right";
  const metaFile = `${options.outputFile}.meta`;
  const pidFile = `${metaFile}.pid`;

  const scriptPath = await writeRunScript({
    command: options.command,
    cwd,
    outputFile: options.outputFile,
    metaFile,
    pidFile,
  });
  const scriptCommand = `bash ${shellQuote(scriptPath)}`;

  let backend: SpawnBackend;
  try {
    backend = await selectBackend(pi);
  } catch (error) {
    await cleanup(scriptPath, metaFile, pidFile);
    throw error;
  }

  if (backend === "headless") {
    if (options.requireTerminal) {
      await cleanup(scriptPath, metaFile, pidFile);
      throw new Error("A visible cmux or Ghostty terminal is required for this agent; no headless fallback was used");
    }
    const result = await pi.exec("bash", [scriptPath], { timeout: timeoutMs });
    const output = await readTextFile(options.outputFile);
    const meta = await parseMeta(metaFile);
    await cleanup(scriptPath, metaFile, pidFile);
    return {
      output,
      outputFile: options.outputFile,
      exitCode: meta?.exitCode ?? result.code,
      backend,
    };
  }

  const paneInput = {
    pi,
    scriptCommand,
    cwd,
    outputFile: options.outputFile,
    label: options.label,
    direction,
    timeoutMs,
  };

  let handle: PaneHandle;
  try {
    handle = backend === "cmux" ? await spawnInCmux(pi, paneInput) : await spawnInGhostty(pi, paneInput);
  } catch (err) {
    await cleanup(scriptPath, metaFile, pidFile);
    throw err;
  }

  const workerPid = options.onStart && await waitForFile(pidFile, 5_000)
    ? await readWorkerPid(pidFile)
    : undefined;
  if (options.onStart && !workerPid) {
    await cleanup(scriptPath, metaFile, pidFile);
    throw new Error(`Worker ownership cannot be verified: no process ID published in terminal ${handle.ref ?? "(unknown)"}`);
  }
  if (options.onStart && workerPid) {
    const worker: SpawnWorker = {
      pid: workerPid,
      host: hostname(),
      backend,
      paneRef: handle.ref,
      outputFile: options.outputFile,
      metaFile,
    };
    try {
      await options.onStart(worker);
    } catch (error) {
      let terminationFailure: string | undefined;
      try {
        await terminateWorker(workerPid);
      } catch (stopError) {
        terminationFailure = stopError instanceof Error ? stopError.message : String(stopError);
      }
      await cleanup(scriptPath, metaFile, pidFile);
      if (terminationFailure) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} Worker termination failed: ${terminationFailure}`);
      }
      throw error;
    }
  }

  const finished = await waitForFile(metaFile, timeoutMs);
  const output = await readTextFile(options.outputFile);

  if (!finished) {
    const runningPid = await readWorkerPid(pidFile);
    let terminationError: string | undefined;
    if (runningPid) {
      try {
        await terminateWorker(runningPid);
      } catch (error) {
        terminationError = error instanceof Error ? error.message : String(error);
      }
      if (!terminationError) await waitForFile(metaFile, 2_000);
    }
    const partialOutput = await readTextFile(options.outputFile);
    await cleanup(scriptPath, metaFile, pidFile);
    throw new Error(
      `Subagent in ${backend} pane ${handle.ref} timed out after ${timeoutMs}ms.${terminationError ? ` Worker termination failed: ${terminationError}.` : ""} Partial output:\n${partialOutput}`,
    );
  }

  const meta = await parseMeta(metaFile);
  await cleanup(scriptPath, metaFile, pidFile);

  // The pane is intentionally left open so the user can read the output.
  return {
    output,
    outputFile: options.outputFile,
    exitCode: meta?.exitCode ?? 0,
    backend,
    paneRef: handle.ref,
  };
}
