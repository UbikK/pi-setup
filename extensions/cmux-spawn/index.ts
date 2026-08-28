import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  mkdir,
  writeFile,
  readFile,
  access,
  constants as fsConstants,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// Factory entry point required by pi extension auto-discovery.
// This module is a shared helper; the actual commands are registered by
// scout.ts, plan.ts, and coordinator.ts.
export default function (_pi: ExtensionAPI) {
  // no-op: commands register elsewhere
}

export interface CmuxSpawnOptions {
  ctx: ExtensionContext;
  /** Command and arguments to execute. The first element is the executable. */
  command: string[];
  /** Working directory for the command. Defaults to ctx.cwd. */
  cwd?: string;
  /** File to capture stdout+stderr to. */
  outputFile: string;
  /** Human-readable label used for the tab/pane title. */
  label?: string;
  /** Pane split direction. Defaults to "right". */
  direction?: "left" | "right" | "up" | "down";
  /** Max time to wait for completion, in ms. Defaults to 10 minutes. */
  timeoutMs?: number;
}

export interface CmuxSpawnResult {
  /** Captured stdout and stderr (clean; no internal markers). */
  output: string;
  outputFile: string;
  exitCode: number;
  cmuxSurfaceRef?: string;
  cmuxPaneRef?: string;
}

const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";
const SHELL_STARTUP_DELAY_MS = 1000;
const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 600_000;

function cmuxArgs(more: string[]): string[] {
  const socket = process.env.CMUX_SOCKET_PATH;
  return socket ? ["--socket", socket, ...more] : more;
}

async function cmuxExec(
  pi: ExtensionAPI,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> {
  return pi.exec(CMUX_BIN, cmuxArgs(args));
}

export function isCmuxAvailable(): boolean {
  return !!process.env.CMUX_WORKSPACE_ID || !!process.env.CMUX_SURFACE_ID;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function writeRunScript(
  command: string[],
  cwd: string,
  outputFile: string,
  metaFile: string
): Promise<string> {
  const dir = dirname(outputFile);
  await mkdir(dir, { recursive: true });

  const scriptPath = join(dir, `.subagent-${randomUUID()}.sh`);
  const cmdLine = command.map(shellQuote).join(" ");

  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `cd ${shellQuote(cwd)}`,
    `${cmdLine} > ${shellQuote(outputFile)} 2>&1`,
    "EXIT_CODE=$?",
    `echo '{"exitCode": '"$EXIT_CODE"', "done": true}' > ${shellQuote(metaFile)}`,
    "exit $EXIT_CODE",
  ].join("\n");

  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  return false;
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function cleanup(...paths: (string | undefined)[]) {
  for (const p of paths) {
    if (!p) continue;
    try {
      await unlink(p);
    } catch {
      // ignore
    }
  }
}

export async function runSubagent(
  pi: ExtensionAPI,
  options: CmuxSpawnOptions
): Promise<CmuxSpawnResult> {
  const cwd = options.cwd ?? options.ctx.cwd;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const direction = options.direction ?? "right";
  const metaFile = `${options.outputFile}.meta`;

  // Ensure output directory exists.
  await mkdir(dirname(options.outputFile), { recursive: true });

  // Always run through a script so quoting and cwd handling are identical
  // whether we run headlessly or inside a cmux pane.
  const scriptPath = await writeRunScript(
    options.command,
    cwd,
    options.outputFile,
    metaFile
  );

  if (!isCmuxAvailable()) {
    // Headless fallback: execute the script directly and wait for it.
    const result = await pi.exec("bash", [scriptPath], { timeout: timeoutMs });
    const output = await readTextFile(options.outputFile);
    const meta = await parseMeta(metaFile);
    await cleanup(scriptPath, metaFile);
    return {
      output,
      outputFile: options.outputFile,
      exitCode: meta?.exitCode ?? result.code,
    };
  }

  // Create a new pane in the current cmux workspace.
  const paneResult = await cmuxExec(pi, [
    "--json",
    "new-pane",
    "--type",
    "terminal",
    "--direction",
    direction,
  ]);

  let surfaceRef: string | undefined;
  let paneRef: string | undefined;
  try {
    const parsed = JSON.parse(paneResult.stdout);
    surfaceRef = parsed.surface_ref;
    paneRef = parsed.pane_ref;
  } catch {
    throw new Error(`cmux new-pane returned unexpected output: ${paneResult.stdout}`);
  }

  if (!surfaceRef) {
    throw new Error("cmux new-pane did not return a surface ref");
  }

  // Wait briefly for the shell inside the new pane to initialize.
  await new Promise((r) => setTimeout(r, SHELL_STARTUP_DELAY_MS));

  // Optionally set a friendly title.
  if (options.label) {
    try {
      await cmuxExec(pi, [
        "send",
        "--surface",
        surfaceRef,
        `printf '\\033]0;${options.label.replace(/'/g, "'\\''")}\\007'`,
      ]);
      await cmuxExec(pi, ["send-key", "--surface", surfaceRef, "Return"]);
    } catch {
      // Title setting is best-effort.
    }
  }

  // Send the script execution command.
  await cmuxExec(pi, ["send", "--surface", surfaceRef, `bash ${scriptPath}`]);
  await cmuxExec(pi, ["send-key", "--surface", surfaceRef, "Return"]);

  // Wait for the script to finish via the meta file.
  const finished = await waitForFile(metaFile, timeoutMs);
  const output = await readTextFile(options.outputFile);

  if (!finished) {
    await cleanup(scriptPath, metaFile);
    throw new Error(
      `Subagent in cmux pane ${surfaceRef} timed out after ${timeoutMs}ms. Partial output:\n${output}`
    );
  }

  const meta = await parseMeta(metaFile);

  // Clean up transient files; leave the output file for callers like /continue.
  await cleanup(scriptPath, metaFile);

  return {
    output,
    outputFile: options.outputFile,
    exitCode: meta?.exitCode ?? 0,
    cmuxSurfaceRef: surfaceRef,
    cmuxPaneRef: paneRef,
  };
}

async function parseMeta(metaFile: string): Promise<{ exitCode: number } | undefined> {
  const text = await readTextFile(metaFile);
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.exitCode === "number") {
      return { exitCode: parsed.exitCode };
    }
  } catch {
    // ignore
  }
  return undefined;
}
