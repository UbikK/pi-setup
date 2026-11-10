import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PaneHandle, PaneSpawnInput } from "./types";

export const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";
const SHELL_STARTUP_DELAY_MS = 1000;

function cmuxArgs(more: string[]): string[] {
  const socket = process.env.CMUX_SOCKET_PATH;
  return socket ? ["--socket", socket, ...more] : more;
}

async function cmuxExec(pi: ExtensionAPI, args: string[]) {
  return pi.exec(CMUX_BIN, cmuxArgs(args));
}

/** cmux advertises itself through env vars in every pane it hosts. */
export function isCmuxAvailable(): boolean {
  return !!process.env.CMUX_WORKSPACE_ID || !!process.env.CMUX_SURFACE_ID;
}

/**
 * Split the current cmux workspace and run the wrapper script in the new pane.
 * cmux has a socket API, so the pane is addressed by the surface ref it returns.
 */
export async function spawnInCmux(pi: ExtensionAPI, input: PaneSpawnInput): Promise<PaneHandle> {
  const paneResult = await cmuxExec(pi, [
    "--json",
    "new-pane",
    "--type",
    "terminal",
    "--direction",
    input.direction,
  ]);

  let surfaceRef: string | undefined;
  try {
    const parsed = JSON.parse(paneResult.stdout);
    surfaceRef = parsed.surface_ref;
  } catch {
    throw new Error(`cmux new-pane returned unexpected output: ${paneResult.stdout}`);
  }
  if (!surfaceRef) throw new Error("cmux new-pane did not return a surface ref");

  // The new pane needs a moment before its shell accepts input.
  await new Promise((r) => setTimeout(r, SHELL_STARTUP_DELAY_MS));

  if (input.label) {
    try {
      await cmuxExec(pi, [
        "send",
        "--surface",
        surfaceRef,
        `printf '\\033]0;${input.label.replace(/'/g, "'\\''")}\\007'`,
      ]);
      await cmuxExec(pi, ["send-key", "--surface", surfaceRef, "Return"]);
    } catch {
      // Title setting is best effort.
    }
  }

  await cmuxExec(pi, ["send", "--surface", surfaceRef, input.scriptCommand]);
  await cmuxExec(pi, ["send-key", "--surface", surfaceRef, "Return"]);

  return { backend: "cmux", ref: surfaceRef };
}
