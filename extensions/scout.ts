import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { runSubagent } from "./terminal-spawn";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("scout", {
    description:
      "Run a quick scout sub-agent on a task and insert its report into the session.",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /scout <task description>", "error");
        return;
      }

      ctx.ui.notify(`Scouting: ${task}`, "info");

      const scoutPrompt = [
        "You are a scout agent. Do not write, edit, delete, or create any files.",
        "Explore the current codebase using only the read-only tools available to you.",
        "Produce a concise SCOUT REPORT with exactly these sections:",
        "- Summary",
        "- Likely files/modules to touch",
        "- Risks or blockers",
        "- Unknowns that need deeper research",
        "- Suggested first step",
        "",
        `Task: ${task}`,
      ].join("\n");

      const scratchDir = join(ctx.cwd, ".pi", "scratch");
      await mkdir(scratchDir, { recursive: true });
      const outputFile = join(scratchDir, `scout-${Date.now()}.md`);

      const result = await runSubagent(pi, {
        ctx,
        command: [
          "pi",
          "-p",
          "--no-session",
          "--no-extensions",
          "--thinking",
          "low",
          "--tools",
          "read,find,grep,ls",
          scoutPrompt,
        ],
        outputFile,
        label: `scout: ${task.slice(0, 40)}`,
        timeoutMs: 120_000,
      });

      const report = result.output || "(scout returned no output)";

      pi.sendMessage(
        {
          customType: "scout-report",
          content: [
            {
              type: "text",
              text: `## Scout report: ${task}\n\n${report}`,
            },
          ],
          display: true,
        },
        { deliverAs: "steer", triggerTurn: false }
      );
    },
  });
}
