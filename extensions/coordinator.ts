import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runSubagent } from "./cmux-spawn";

interface Delegation {
  id: string;
  mode: "scout" | "plan";
  task: string;
  status: "pending" | "done" | "failed";
  outputFile: string;
  error?: string;
}

export default function (pi: ExtensionAPI) {
  function getScratchDir(ctx: ExtensionContext): string {
    return join(ctx.cwd, ".pi", "scratch");
  }

  async function ensureScratchDir(ctx: ExtensionContext): Promise<string> {
    const dir = getScratchDir(ctx);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  function getDelegations(ctx: ExtensionContext): Delegation[] {
    const branch = ctx.sessionManager.getBranch();
    const delegations: Delegation[] = [];
    for (const entry of branch) {
      if (entry.type === "custom" && entry.customType === "delegation") {
        delegations.push(entry.data as Delegation);
      }
    }
    return delegations;
  }

  function findDelegation(ctx: ExtensionContext, id: string): Delegation | undefined {
    const delegations = getDelegations(ctx);
    // Return the latest entry for this id
    for (let i = delegations.length - 1; i >= 0; i--) {
      if (delegations[i].id === id) return delegations[i];
    }
    return undefined;
  }

  function saveDelegation(delegation: Delegation) {
    pi.appendEntry("delegation", delegation);
  }

  function buildPrompt(mode: "scout" | "plan", task: string): string {
    if (mode === "scout") {
      return [
        "You are a scout agent. Do not write, edit, delete, or create any files.",
        "Explore the current codebase using only read-only tools.",
        "Produce a concise SCOUT REPORT with exactly these sections:",
        "- Summary",
        "- Likely files/modules to touch",
        "- Risks or blockers",
        "- Unknowns that need deeper research",
        "- Suggested first step",
        "",
        `Task: ${task}`,
      ].join("\n");
    }

    return [
      "You are a planning agent. Do not write, edit, delete, or create any files.",
      "Explore the current codebase as needed, then produce a concrete plan as a JSON object inside a markdown code block.",
      "Use exactly this shape:",
      "",
      "```json",
      JSON.stringify({
        summary: "one-sentence overview",
        steps: [
          {
            title: "short step name",
            description: "detailed instructions for this single reviewable change",
          },
        ],
      }, null, 2),
      "```",
      "",
      "Rules:",
      "- Each step must be small enough to review in one diff.",
      "- Steps should not depend on later steps.",
      "- Do not include git merge or commit steps.",
      "",
      `Task: ${task}`,
    ].join("\n");
  }

  // /delegate scout|plan <task>
  pi.registerCommand("delegate", {
    description: "Delegate a scout or planning task to a read-only sub-agent",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      let mode: "scout" | "plan" = "scout";
      let task = args.trim();

      if (parts[0] === "scout" || parts[0] === "plan") {
        mode = parts[0];
        task = parts.slice(1).join(" ").trim();
      }

      if (!task) {
        ctx.ui.notify("Usage: /delegate [scout|plan] <task description>", "error");
        return;
      }

      const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const scratchDir = await ensureScratchDir(ctx);
      const outputFile = join(scratchDir, `${id}.md`);

      const delegation: Delegation = {
        id,
        mode,
        task,
        status: "pending",
        outputFile,
      };
      saveDelegation(delegation);

      ctx.ui.notify(`Delegated ${mode} agent ${id}`, "info");

      try {
        const prompt = buildPrompt(mode, task);
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
            prompt,
          ],
          outputFile,
          label: `${mode}: ${task.slice(0, 40)}`,
          timeoutMs: 180_000,
        });

        // outputFile is already populated by the subagent script.
        const status = result.exitCode === 0 ? "done" : "failed";
        saveDelegation({ ...delegation, status, error: status === "failed" ? `exit ${result.exitCode}` : undefined });

        if (status === "done") {
          ctx.ui.notify(`${mode} agent ${id} finished`, "info");
        } else {
          ctx.ui.notify(`${mode} agent ${id} failed (exit ${result.exitCode})`, "error");
        }

        pi.sendMessage(
          {
            customType: "delegation-complete",
            content: [
              {
                type: "text",
                text:
                  status === "done"
                    ? `**${mode} agent \`${id}\` finished.**\n\nRun \`/continue ${id}\` to bring its report into the conversation.`
                    : `**${mode} agent \`${id}\` finished with exit ${result.exitCode}.**\n\nRun \`/continue ${id}\` to inspect the partial report.`,
              },
            ],
            display: true,
          },
          { deliverAs: "steer", triggerTurn: false }
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        saveDelegation({ ...delegation, status: "failed", error });
        ctx.ui.notify(`Agent ${id} failed: ${error}`, "error");
      }
    },
  });

  // /agents
  pi.registerCommand("agents", {
    description: "List delegated sub-agents and their status",
    handler: async (_args, ctx) => {
      const delegations = getDelegations(ctx);
      if (delegations.length === 0) {
        ctx.ui.notify("No delegated agents yet.", "info");
        return;
      }

      const lines = delegations.map((d) => {
        const status = d.status === "done" ? "✓" : d.status === "failed" ? "✗" : "○";
        return `${status} \`${d.id}\` [${d.mode}] ${d.task}`;
      });

      pi.sendMessage(
        {
          customType: "agent-list",
          content: [
            { type: "text", text: `## Delegated agents\n\n${lines.join("\n")}` },
          ],
          display: true,
        },
        { deliverAs: "steer", triggerTurn: false }
      );
    },
  });

  // /continue <id>
  pi.registerCommand("continue", {
    description: "Bring a finished sub-agent's report into the main conversation",
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) {
        ctx.ui.notify("Usage: /continue <agent-id>", "error");
        return;
      }

      const delegation = findDelegation(ctx, id);
      if (!delegation) {
        ctx.ui.notify(`No agent found with id \`${id}\`.`, "error");
        return;
      }

      if (delegation.status !== "done") {
        ctx.ui.notify(`Agent \`${id}\` is not done yet (status: ${delegation.status}).`, "error");
        return;
      }

      let output: string;
      try {
        output = await readFile(delegation.outputFile, "utf8");
      } catch (err) {
        ctx.ui.notify(
          `Could not read output file: ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
        return;
      }

      pi.sendUserMessage(
        `Here is the ${delegation.mode} report from sub-agent \`${id}\` for the task: ${delegation.task}\n\n---\n\n${output}`,
        { triggerTurn: true }
      );
    },
  });
}
