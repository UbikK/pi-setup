import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { runSubagent } from "./terminal-spawn/index.ts";
import { readFeatureWorkflow, updateFeatureWorkflow } from "./lib/feature-store";

interface PlanStep {
  title: string;
  description: string;
}

interface PlanState {
  task: string;
  summary: string;
  steps: PlanStep[];
  currentIndex: number;
  featureId?: string;
}

export default function (pi: ExtensionAPI) {
  // Restore the latest plan from the current branch
  function getPlan(ctx: ExtensionContext): PlanState | undefined {
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (
        entry.type === "custom" &&
        entry.customType === "plan-state" &&
        entry.data
      ) {
        return entry.data as PlanState;
      }
    }
    return undefined;
  }

  function savePlan(plan: PlanState) {
    pi.appendEntry("plan-state", plan);
  }

  function extractJson<T = unknown>(text: string): T {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    const raw = match ? match[1] : text;
    return JSON.parse(raw);
  }

  // /plan <task>
  pi.registerCommand("plan", {
    description: "Generate a reviewable plan for a task",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /plan <task description>", "error");
        return;
      }

      ctx.ui.notify("Generating plan...", "info");

      const planningPrompt = [
        "You are a planning agent. Do not write, edit, or delete any files.",
        "Explore the codebase as needed, then produce a concrete plan as a JSON object inside a markdown code block.",
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

      const scratchDir = join(ctx.cwd, ".pi", "scratch");
      await mkdir(scratchDir, { recursive: true });
      const outputFile = join(scratchDir, `plan-${Date.now()}.json`);

      const result = await runSubagent(pi, {
        ctx,
        command: [
          "pi",
          "-p",
          "--no-session",
          "--no-extensions",
          "--thinking", "low",
          "--tools", "read,find,grep,ls",
          planningPrompt,
        ],
        outputFile,
        label: `plan: ${task.slice(0, 40)}`,
        timeoutMs: 120_000,
      });

      if (result.exitCode !== 0) {
        ctx.ui.notify(
          `Planning agent failed (exit ${result.exitCode}). Output saved to ${outputFile}`,
          "error"
        );
        return;
      }

      let plan: PlanState;
      try {
        const parsed = extractJson<{ summary: string; steps: PlanStep[] }>(result.output);
        plan = {
          task,
          summary: parsed.summary,
          steps: parsed.steps,
          currentIndex: 0,
        };
      } catch (err) {
        ctx.ui.notify(
          `Failed to parse plan: ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
        return;
      }

      savePlan(plan);

      const lines = [
        `## Plan: ${task}`,
        "",
        `**Summary:** ${plan.summary}`,
        "",
        ...plan.steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.description}`),
        "",
        `Run \`/plan-next\` to begin step 1.`,
      ];

      pi.sendMessage(
        {
          customType: "plan-created",
          content: [{ type: "text", text: lines.join("\n") }],
          display: true,
        },
        { deliverAs: "steer", triggerTurn: false }
      );
    },
  });

  // /plan-next
  pi.registerCommand("plan-next", {
    description: "Run the next step of the current plan",
    handler: async (_args, ctx) => {
      const plan = getPlan(ctx);
      if (!plan) {
        ctx.ui.notify("No active plan. Create one with /plan.", "error");
        return;
      }

      if (plan.currentIndex >= plan.steps.length) {
        if (plan.featureId) {
          const workflow = await readFeatureWorkflow(ctx.cwd, plan.featureId);
          if (workflow.approval !== "approved") {
            ctx.ui.notify(`Feature ${plan.featureId} has no approved plan; refusing execution.`, "error");
            return;
          }
          const completed = await updateFeatureWorkflow(ctx.cwd, workflow.id, workflow.revision, (current) => ({
            ...current,
            stage: "complete",
            status: "completed",
            currentStepIndex: current.steps.length,
            steps: current.steps.map((step) => ({ ...step, status: "passed" })),
          }));
          ctx.ui.notify(`Feature ${completed.id} plan complete.`, "info");
          return;
        }
        ctx.ui.notify("Plan complete.", "info");
        return;
      }

      const step = plan.steps[plan.currentIndex];
      const confirmed = await ctx.ui.confirm(
        `Step ${plan.currentIndex + 1}/${plan.steps.length}`,
        `${step.title}\n\n${step.description}\n\nProceed?`
      );
      if (!confirmed) return;

      if (plan.featureId) {
        const workflow = await readFeatureWorkflow(ctx.cwd, plan.featureId);
        if (workflow.approval !== "approved" || workflow.stage !== "execution") {
          ctx.ui.notify(`Feature ${plan.featureId} is not approved for execution.`, "error");
          return;
        }
        await updateFeatureWorkflow(ctx.cwd, workflow.id, workflow.revision, (current) => ({
          ...current,
          currentStepIndex: plan.currentIndex,
          steps: current.steps.map((item, index) => {
            if (index === plan.currentIndex) return { ...item, status: "running" };
            if (index < plan.currentIndex && item.status === "running") return { ...item, status: "passed" };
            return item;
          }),
        }));
      }

      // Advance before execution so the state is correct if the user reloads.
      // Feature workflows persist the current running step and replay it on resume if interrupted.
      savePlan({ ...plan, currentIndex: plan.currentIndex + 1 });

      pi.sendUserMessage(
        [
          `Execute this plan step (step ${plan.currentIndex + 1} of ${plan.steps.length}):`,
          "",
          `**${step.title}**`,
          step.description,
        ].join("\n")
      );
    },
  });

  // /plan-reset
  pi.registerCommand("plan-reset", {
    description: "Clear the current plan",
    handler: async (_args, ctx) => {
      savePlan({ task: "", summary: "", steps: [], currentIndex: 0 });
      ctx.ui.notify("Plan cleared.", "info");
    },
  });
}
