import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { runSubagent } from "./terminal-spawn";
import { DEFAULT_AGENT_TOOLS, discoverAgents, findAgent } from "./lib/agents-lib";

interface Delegation {
  id: string;
  mode: string;
  task: string;
  status: "pending" | "done" | "failed";
  outputFile: string;
  model?: string;
  thinkingLevel?: string;
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

  function buildPrompt(mode: string, task: string): string {
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

  // /delegate [scout|plan|<agent-name>] <task>
  pi.registerCommand("delegate", {
    description: "Delegate a task to a read-only sub-agent (scout, plan, or a named agent)",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const head = parts[0] ?? "";
      const namedAgent = head ? findAgent(ctx.cwd, head) : undefined;
      const isMode = head === "scout" || head === "plan" || !!namedAgent;

      const mode = isMode ? head : "scout";
      const task = (isMode ? parts.slice(1).join(" ") : args).trim();

      if (!task) {
        const available = discoverAgents(ctx.cwd)
          .map((a) => a.name)
          .join(", ");
        ctx.ui.notify(
          [
            "Usage: /delegate [scout|plan|<agent>] <task description>",
            available ? `Agents: ${available}` : "No named agents found in <agent-dir>/agents or .pi/agents",
          ].join("\n"),
          "error"
        );
        return;
      }

      const agentModel = namedAgent?.model;
      if (agentModel) {
        const separator = agentModel.indexOf("/");
        if (separator <= 0 || separator === agentModel.length - 1) {
          ctx.ui.notify(`Agent ${mode} has invalid model setting: ${agentModel}`, "error");
          return;
        }
        const provider = agentModel.slice(0, separator);
        const modelId = agentModel.slice(separator + 1);
        const resolvedModel = ctx.modelRegistry.find(provider, modelId);
        if (!resolvedModel) {
          ctx.ui.notify(`Agent ${mode} model is not available: ${agentModel}`, "error");
          return;
        }
        if (!ctx.modelRegistry.hasConfiguredAuth(resolvedModel)) {
          ctx.ui.notify(`Agent ${mode} model has no configured authentication: ${agentModel}`, "error");
          return;
        }
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
        model: agentModel,
        thinkingLevel: namedAgent?.thinkingLevel ?? "low",
      };
      saveDelegation(delegation);

      ctx.ui.notify(`Delegated ${mode} agent ${id}`, "info");

      // Named agents supply their own system prompt file; built-in modes embed
      // the prompt in the message.
      let promptFile: string | undefined;
      let prompt: string;
      let tools: string[];

      if (namedAgent) {
        promptFile = join(scratchDir, `${id}.system.md`);
        await writeFile(promptFile, namedAgent.systemPrompt, "utf8");
        prompt = `Task: ${task}`;
        tools = namedAgent.tools ?? DEFAULT_AGENT_TOOLS;
      } else {
        prompt = buildPrompt(mode, task);
        tools = DEFAULT_AGENT_TOOLS;
      }

      try {
        const result = await runSubagent(pi, {
          ctx,
          command: [
            "pi",
            "-p",
            "--no-session",
            "--no-extensions",
            "--thinking",
            namedAgent?.thinkingLevel ?? "low",
            ...(agentModel ? ["--model", agentModel] : []),
            "--tools",
            tools.join(","),
            ...(promptFile ? ["--append-system-prompt", promptFile] : []),
            prompt,
          ],
          outputFile,
          label: `${mode}: ${task.slice(0, 40)}`,
          timeoutMs: 180_000,
        });

        // outputFile is already populated by the subagent script.
        const status = result.exitCode === 0 ? "done" : "failed";
        const error = status === "failed"
          ? result.output.trim().slice(-1000) || `exit ${result.exitCode}`
          : undefined;
        saveDelegation({ ...delegation, status, error });
        if (promptFile) await unlink(promptFile).catch(() => {});

        if (status === "done") {
          ctx.ui.notify(
            `Delegated ${mode} agent ${id} finished${agentModel ? ` using ${agentModel} (${namedAgent?.thinkingLevel ?? "low"} thinking)` : ""}`,
            "info",
          );
        } else {
          ctx.ui.notify(
            `Agent ${id} failed (exit ${result.exitCode})${error ? `: ${error}` : ""}`,
            "error",
          );
        }

        pi.sendMessage(
          {
            customType: "delegation-complete",
            content: [
              {
                type: "text",
                text:
                  status === "done"
                    ? `**${mode} agent \`${id}\` finished.**${agentModel ? ` Model: \`${agentModel}\` (${namedAgent?.thinkingLevel ?? "low"} thinking).` : ""}\n\nRun \`/continue ${id}\` to bring its report into the conversation.`
                    : `**${mode} agent \`${id}\` finished with exit ${result.exitCode}.**${error ? `\n\n${error}` : ""}\n\nRun \`/continue ${id}\` to inspect the partial report.`,
              },
            ],
            display: true,
          },
          { deliverAs: "steer", triggerTurn: false }
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        saveDelegation({ ...delegation, status: "failed", error });
        if (promptFile) await unlink(promptFile).catch(() => {});
        ctx.ui.notify(`Agent ${id} failed: ${error}`, "error");
      }
    },
  });

  // /agents
  pi.registerCommand("agents", {
    description: "List available agent definitions and delegated sub-agents",
    handler: async (_args, ctx) => {
      const available = discoverAgents(ctx.cwd);
      const availableLines = [
        "`scout` — read-only recon report",
        "`plan` — read-only reviewable plan",
        ...available.map((a) => {
          const options = [
            a.tools ? `tools: ${a.tools.join(",")}` : "",
            a.model ? `model: ${a.model}` : "",
            a.thinkingLevel ? `thinking: ${a.thinkingLevel}` : "",
          ].filter(Boolean).join(", ");
          return `\`${a.name}\` — ${a.description}${options ? ` (${options})` : ""}`;
        }),
      ];

      const delegations = getDelegations(ctx);
      const latest = new Map<string, (typeof delegations)[number]>();
      for (const d of delegations) latest.set(d.id, d);

      const delegationLines = [...latest.values()].map((d) => {
        const status = d.status === "done" ? "✓" : d.status === "failed" ? "✗" : "○";
        const model = d.model ? ` | model: ${d.model} (${d.thinkingLevel ?? "low"} thinking)` : "";
        return `${status} \`${d.id}\` [${d.mode}] ${d.task}${model}`;
      });

      pi.sendMessage(
        {
          customType: "agent-list",
          content: [
            {
              type: "text",
              text: [
                "## Available agents",
                "",
                availableLines.join("\n"),
                "",
                "## Delegations",
                "",
                delegationLines.length > 0 ? delegationLines.join("\n") : "_none yet_",
              ].join("\n"),
            },
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
        `Here is the ${delegation.mode} report from sub-agent \`${id}\` for the task: ${delegation.task}\n\n---\n\n${output}`
      );
    },
  });
}
