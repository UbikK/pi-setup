import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SplitDirection = "left" | "right" | "up" | "down";

export type SpawnBackend = "cmux" | "ghostty" | "headless";

export interface SpawnOptions {
  ctx: ExtensionContext;
  /** Command and arguments to execute. The first element is the executable. */
  command: string[];
  /** Working directory for the command. Defaults to ctx.cwd. */
  cwd?: string;
  /** File to capture stdout+stderr to. */
  outputFile: string;
  /** Human-readable label used for the pane/terminal title. */
  label?: string;
  /** Pane split direction. Defaults to "right". */
  direction?: SplitDirection;
  /** Max time to wait for completion, in ms. Defaults to 10 minutes. */
  timeoutMs?: number;
}

export interface SpawnResult {
  /** Captured stdout and stderr (clean; no internal markers). */
  output: string;
  outputFile: string;
  exitCode: number;
  backend: SpawnBackend;
  /** Backend-specific pane identifier: cmux surface ref or Ghostty terminal UUID. */
  paneRef?: string;
}

/** Everything a pane backend needs after the wrapper script has been written. */
export interface PaneSpawnInput {
  pi: ExtensionAPI;
  /** Single-quoted shell command that runs the wrapper script. */
  scriptCommand: string;
  cwd: string;
  outputFile: string;
  label?: string;
  direction: SplitDirection;
  timeoutMs: number;
}

export interface PaneHandle {
  backend: SpawnBackend;
  ref?: string;
}
