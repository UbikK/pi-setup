import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
import type { PaneHandle, SpawnBackend, SpawnOptions, SpawnResult } from "./types";

export type {
  PaneHandle,
  PaneSpawnInput,
  SplitDirection,
  SpawnBackend,
  SpawnOptions,
  SpawnResult,
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

/**
 * Run a sub-agent, preferring a visible terminal pane and falling back to a
 * headless child process. Which backend is used depends on the host terminal:
 * cmux (socket API) > Ghostty (AppleScript) > headless.
 */
export async function runSubagent(pi: ExtensionAPI, options: SpawnOptions): Promise<SpawnResult> {
  const cwd = options.cwd ?? options.ctx.cwd;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const direction = options.direction ?? "right";
  const metaFile = `${options.outputFile}.meta`;

  const scriptPath = await writeRunScript({
    command: options.command,
    cwd,
    outputFile: options.outputFile,
    metaFile,
  });
  const scriptCommand = `bash ${shellQuote(scriptPath)}`;

  const backend = await selectBackend(pi);

  if (backend === "headless") {
    const result = await pi.exec("bash", [scriptPath], { timeout: timeoutMs });
    const output = await readTextFile(options.outputFile);
    const meta = await parseMeta(metaFile);
    await cleanup(scriptPath, metaFile);
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
    await cleanup(scriptPath, metaFile);
    throw err;
  }

  const finished = await waitForFile(metaFile, timeoutMs);
  const output = await readTextFile(options.outputFile);

  if (!finished) {
    await cleanup(scriptPath, metaFile);
    throw new Error(
      `Subagent in ${backend} pane ${handle.ref} timed out after ${timeoutMs}ms. Partial output:\n${output}`
    );
  }

  const meta = await parseMeta(metaFile);
  await cleanup(scriptPath, metaFile);

  // The pane is intentionally left open so the user can read the output.
  return {
    output,
    outputFile: options.outputFile,
    exitCode: meta?.exitCode ?? 0,
    backend,
    paneRef: handle.ref,
  };
}
