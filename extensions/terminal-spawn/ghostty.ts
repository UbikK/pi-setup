import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shellQuote } from "./shared";
import type { PaneHandle, PaneSpawnInput } from "./types";

/** Ghostty on macOS has no IPC socket; AppleScript is the only automation surface. */
const APPLESCRIPT_TIMEOUT_MS = 10_000;

/** Terminal is addressed by UUID because the surface id is not exposed to AppleScript. */
const LIST_SCRIPT = `
on run argv
  tell application "Ghostty"
    set out to ""
    repeat with w in windows
      repeat with t in terminals of w
        set out to out & (id of t) & " " & (tty of t) & linefeed
      end repeat
    end repeat
    return out
  end tell
end run
`;

/**
 * `command` is run through a shell and splits on spaces, so the script path must
 * be single-quoted. Bare paths and double quotes both fail silently.
 */
const SPLIT_SCRIPT = `
on run argv
  set targetId to item 1 of argv
  set scriptCmd to item 2 of argv
  set workDir to item 3 of argv
  set labelText to item 4 of argv
  set dirName to item 5 of argv

  tell application "Ghostty"
    set target to first terminal whose id is targetId

    set config to new surface configuration
    set command of config to scriptCmd
    set initial working directory of config to workDir

    if dirName is "down" then
      set newTerm to split target direction down with configuration config
    else if dirName is "up" then
      set newTerm to split target direction up with configuration config
    else if dirName is "left" then
      set newTerm to split target direction left with configuration config
    else
      set newTerm to split target direction right with configuration config
    end if

    if labelText is not "" then set name override of newTerm to labelText
    return id of newTerm
  end tell
end run
`;

interface GhosttyTerminal {
  id: string;
  tty: string;
}

const GHOSTTY_BINARY = "Ghostty.app/Contents/MacOS/ghostty";

/**
 * `ps -o tty=` prints `ttys014` while Ghostty's AppleScript reports `/dev/ttys014`,
 * so both sides are normalized before comparison.
 */
function normalizeTty(tty: string): string {
  return tty.replace(/^\/dev\//, "").trim();
}

/**
 * `tell application "Ghostty"` launches the app when it is not running, so the
 * process must be probed first. `pgrep -x ghostty` is not usable here: inside a
 * Ghostty pane it hides the app because it is an ancestor process, so a plain
 * `ps` scan is the only reliable check.
 */
async function isGhosttyRunning(pi: ExtensionAPI): Promise<boolean> {
  const res = await pi.exec("ps", ["-axo", "comm="]);
  if (res.code !== 0) return false;
  return res.stdout.includes(GHOSTTY_BINARY);
}

async function listTerminals(pi: ExtensionAPI): Promise<GhosttyTerminal[]> {
  const res = await pi.exec("osascript", ["-e", LIST_SCRIPT], { timeout: APPLESCRIPT_TIMEOUT_MS });
  if (res.code !== 0) return [];

  const terminals: GhosttyTerminal[] = [];
  for (const line of res.stdout.split("\n")) {
    const [id, tty] = line.trim().split(/\s+/);
    if (id && tty) terminals.push({ id, tty });
  }
  return terminals;
}

/** TTYs of this process and its ancestors, nearest first. */
async function ancestorTtys(pi: ExtensionAPI): Promise<string[]> {
  const ttys: string[] = [];
  let pid = process.pid;

  for (let depth = 0; depth < 16; depth++) {
    const res = await pi.exec("ps", ["-o", "ppid=,tty=", "-p", String(pid)]);
    const line = res.stdout.trim();
    if (!line) break;

    const [ppidRaw, ttyRaw] = line.split(/\s+/);
    if (ttyRaw && ttyRaw !== "??" && ttyRaw !== "-") ttys.push(normalizeTty(ttyRaw));

    const ppid = Number.parseInt(ppidRaw ?? "", 10);
    if (!Number.isFinite(ppid) || ppid <= 1) break;
    pid = ppid;
  }

  return ttys;
}

/**
 * Find the Ghostty terminal pi is running in.
 *
 * Ghostty's AppleScript terminal id is a UUID while `GHOSTTY_SURFACE_ID` is an
 * unrelated hex number, so the environment cannot be used to address a surface.
 * The tty of a parent process is the only reliable link. Returns undefined when
 * pi does not run inside Ghostty — splitting then would hijack an unrelated
 * window, so the caller must fall back to a headless run instead.
 */
async function findOwningTerminal(
  pi: ExtensionAPI
): Promise<{ id: string; tty: string } | undefined> {
  if (!process.env.GHOSTTY_SURFACE_ID && !process.env.GHOSTTY_RESOURCES_DIR) return undefined;
  if (!(await isGhosttyRunning(pi))) return undefined;

  const ttys = await ancestorTtys(pi);
  if (ttys.length === 0) return undefined;

  const terminals = await listTerminals(pi);
  return terminals.find((t) => ttys.includes(normalizeTty(t.tty)));
}

export async function isGhosttyAvailable(pi: ExtensionAPI): Promise<boolean> {
  return (await findOwningTerminal(pi)) !== undefined;
}

/**
 * Split the Ghostty terminal pi runs in and run the wrapper script there.
 * Ghostty surfaces stay open after the command exits (`pid` becomes 0), so the
 * output remains readable and no teardown is required.
 */
export async function spawnInGhostty(pi: ExtensionAPI, input: PaneSpawnInput): Promise<PaneHandle> {
  const owner = await findOwningTerminal(pi);
  if (!owner) throw new Error("pi is not running inside a Ghostty terminal");

  const res = await pi.exec(
    "osascript",
    [
      "-e",
      SPLIT_SCRIPT,
      owner.id,
      input.scriptCommand,
      input.cwd,
      input.label ?? "",
      input.direction,
    ],
    { timeout: APPLESCRIPT_TIMEOUT_MS }
  );

  if (res.code !== 0) {
    throw new Error(`Ghostty split failed: ${res.stderr.trim() || `exit ${res.code}`}`);
  }

  const id = res.stdout.trim();
  if (!id) throw new Error(`Ghostty split returned no terminal id: ${res.stdout}`);

  return { backend: "ghostty", ref: id };
}
