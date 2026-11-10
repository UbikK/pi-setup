import { access, constants as fsConstants, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const POLL_INTERVAL_MS = 500;

/** Single-quote a string for POSIX shells (and for Ghostty's `command` config value). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Write a wrapper script that runs `command` with output captured to
 * `outputFile` and an exit-code meta file. Both backends use the same script so
 * quoting and cwd handling behave identically.
 */
export async function writeRunScript(options: {
  command: string[];
  cwd: string;
  outputFile: string;
  metaFile: string;
}): Promise<string> {
  const dir = dirname(options.outputFile);
  await mkdir(dir, { recursive: true });

  const scriptPath = join(dir, `.subagent-${randomUUID()}.sh`);
  const cmdLine = options.command.map(shellQuote).join(" ");

  const script = [
    "#!/usr/bin/env bash",
    `cd ${shellQuote(options.cwd)}`,
    `set +e`,
    `${cmdLine} > ${shellQuote(options.outputFile)} 2>&1`,
    "EXIT_CODE=$?",
    `echo '{"exitCode": '"$EXIT_CODE"', "done": true}' > ${shellQuote(options.metaFile)}`,
    "exit $EXIT_CODE",
  ].join("\n");

  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

export async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
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

export async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function cleanup(...paths: (string | undefined)[]): Promise<void> {
  for (const p of paths) {
    if (!p) continue;
    try {
      await unlink(p);
    } catch {
      // ignore
    }
  }
}

export async function parseMeta(metaFile: string): Promise<{ exitCode: number } | undefined> {
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
