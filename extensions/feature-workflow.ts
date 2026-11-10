import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSubagent } from "./terminal-spawn/index.ts";
import {
  createFeatureWorkflow,
  listFeatureWorkflows,
  readFeatureArtifact,
  readFeatureWorkflow,
  updateFeatureWorkflow,
  writeFeatureArtifact,
} from "./lib/feature-store";
import type { FeatureArtifact, FeatureWorkflow } from "./lib/feature-store";
import { DEFAULT_AGENT_TOOLS, findAgent } from "./lib/agents-lib";

const SCRATCH_DIR = ".pi/scratch";
const MAX_PLAN_REVISIONS = 1;

interface PlanOutput {
  summary: string;
  steps: Array<{ title: string; description: string; verification?: string[] }>;
}

function extractJson<T>(text: string): T {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/i);
  return JSON.parse(match?.[1] ?? text) as T;
}

function parsePlan(text: string): PlanOutput {
  const parsed = extractJson<PlanOutput>(text);
  if (
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.steps) ||
    parsed.steps.length === 0 ||
    !parsed.steps.every((step) =>
      step && typeof step.title === "string" && typeof step.description === "string",
    )
  ) {
    throw new Error("Planner output must contain a summary and at least one valid step");
  }
  return parsed;
}

function parseVerdict(text: string): "approve" | "revise" | "block" | undefined {
  const match = text.match(/^\s*VERDICT:\s*(APPROVE|REVISE|BLOCK)\s*$/im);
  return match?.[1].toLowerCase() as "approve" | "revise" | "block" | undefined;
}

function splitTitleAndRequest(value: string): { title: string; request: string } | undefined {
  const separator = value.indexOf(" :: ");
  if (separator < 1) return undefined;
  const title = value.slice(0, separator).trim();
  const request = value.slice(separator + 4).trim();
  return title && request ? { title, request } : undefined;
}

function formatPlan(workflow: FeatureWorkflow): string {
  const steps = workflow.steps.map((step, index) =>
    `${index + 1}. **${step.title}** — ${step.description}`,
  );
  return [
    `## ${workflow.title} (${workflow.id})`,
    "",
    workflow.summary ?? workflow.request,
    "",
    ...steps,
  ].join("\n");
}

export default function (pi: ExtensionAPI) {
  async function update(
    cwd: string,
    workflow: FeatureWorkflow,
    patch: (current: FeatureWorkflow) => FeatureWorkflow,
  ): Promise<FeatureWorkflow> {
    return updateFeatureWorkflow(cwd, workflow.id, workflow.revision, patch);
  }

  async function saveArtifact(
    cwd: string,
    workflow: FeatureWorkflow,
    artifact: FeatureArtifact,
    content: string,
    patch: (current: FeatureWorkflow) => FeatureWorkflow,
  ): Promise<FeatureWorkflow> {
    const path = await writeFeatureArtifact(cwd, workflow.id, artifact, content);
    return update(cwd, workflow, (current) => patch({
      ...current,
      artifacts: { ...current.artifacts, [artifact]: path },
    }));
  }

  async function runAgent(
    ctx: ExtensionContext,
    workflow: FeatureWorkflow,
    label: string,
    prompt: string,
    options: { model?: string; thinkingLevel?: string; systemPrompt?: string },
  ): Promise<string> {
    const scratchDir = join(ctx.cwd, SCRATCH_DIR);
    await mkdir(scratchDir, { recursive: true });
    const outputFile = join(scratchDir, `feature-${workflow.id}-${label}-${Date.now()}.md`);
    const promptFile = options.systemPrompt
      ? join(scratchDir, `feature-${workflow.id}-${label}-${Date.now()}.system.md`)
      : undefined;

    try {
      if (promptFile) await writeFile(promptFile, options.systemPrompt!, "utf8");
      const result = await runSubagent(pi, {
        ctx,
        command: [
          "pi", "-p", "--no-session", "--no-extensions",
          "--thinking", options.thinkingLevel ?? "low",
          ...(options.model ? ["--model", options.model] : []),
          "--tools", DEFAULT_AGENT_TOOLS.join(","),
          ...(promptFile ? ["--append-system-prompt", promptFile] : []),
          prompt,
        ],
        outputFile,
        label: `${label}: ${workflow.title.slice(0, 40)}`,
        timeoutMs: 180_000,
      });
      if (result.exitCode !== 0) {
        throw new Error(`${label} agent failed (exit ${result.exitCode}): ${result.output.trim().slice(-1000)}`);
      }
      if (!result.output.trim()) throw new Error(`${label} agent returned empty output`);
      return result.output;
    } finally {
      if (promptFile) await unlink(promptFile).catch(() => {});
      await unlink(outputFile).catch(() => {});
    }
  }

  async function runWorkflow(ctx: ExtensionContext, initial: FeatureWorkflow): Promise<FeatureWorkflow> {
    let workflow = initial;
    try {
      if (workflow.status === "cancelled" || workflow.status === "completed") {
        throw new Error(`Cannot resume a ${workflow.status} feature`);
      }
      if (workflow.stage === "approval" && workflow.status === "awaiting_approval") return workflow;
      if (workflow.status !== "active") {
        workflow = await update(ctx.cwd, workflow, (current) => ({ ...current, status: "active", lastError: undefined }));
      }

      if (workflow.stage === "scout") {
        const report = await runAgent(ctx, workflow, "scout", [
          "You are a scout agent. Read-only: do not create, modify, or delete files.",
          "Return a concise report with sections: Summary, Likely files/modules to touch, Risks or blockers, Unknowns, Suggested first step.",
          `Feature request: ${workflow.request}`,
        ].join("\n\n"), {});
        workflow = await saveArtifact(ctx.cwd, workflow, "scout", report, (current) => ({
          ...current,
          stage: "plan",
          status: "active",
          lastError: undefined,
        }));
      }

      if (workflow.stage === "plan") {
        const scout = await readFeatureArtifact(ctx.cwd, workflow.id, "scout");
        const planText = await runAgent(ctx, workflow, "plan", [
          "You are a read-only planning agent. Do not create, modify, or delete files.",
          "Produce a reviewable plan as one JSON object in a ```json code block, shape: {\"summary\": string, \"steps\": [{\"title\": string, \"description\": string, \"verification\": string[]}]}.",
          "Make as many steps as needed for this feature; do not impose a fixed step count. Keep each step reviewable and independently verifiable.",
          `Feature request:\n${workflow.request}`,
          `Scout report:\n${scout}`,
        ].join("\n\n"), {});
        const plan = parsePlan(planText);
        const planJson = `${JSON.stringify(plan, null, 2)}\n`;
        workflow = await saveArtifact(ctx.cwd, workflow, "plan", planJson, (current) => ({
          ...current,
          stage: "architect",
          status: "active",
          summary: plan.summary,
          steps: plan.steps.map((step, index) => ({
            id: `step-${index + 1}`,
            title: step.title,
            description: step.description,
            verification: step.verification,
            status: "pending",
          })),
          lastError: undefined,
        }));
      }

      if (workflow.stage === "architect") {
        const architect = findAgent(ctx.cwd, "architect");
        const architectModel = workflow.architectModel;
        if (!architect || !architectModel) throw new Error("Architect agent/model is not configured; no fallback is allowed");
        const separator = architectModel.indexOf("/");
        if (separator <= 0 || separator === architectModel.length - 1) {
          throw new Error(`Architect model is invalid: ${architectModel}`);
        }
        const model = ctx.modelRegistry.find(architectModel.slice(0, separator), architectModel.slice(separator + 1));
        if (!model) throw new Error(`Architect model is not available: ${architectModel}`);
        if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
          throw new Error(`Architect model has no configured authentication: ${architectModel}`);
        }

        const scout = await readFeatureArtifact(ctx.cwd, workflow.id, "scout");
        const planArtifact = await readFeatureArtifact(ctx.cwd, workflow.id, "plan");
        const architectSystemPrompt = [
          architect.systemPrompt,
          "For this workflow, review the proposed plan against the request and scout report.",
          "End your response with exactly one machine-readable line: VERDICT: APPROVE, VERDICT: REVISE, or VERDICT: BLOCK.",
          "Use REVISE only for concrete plan changes. Use BLOCK for a fundamental blocker. State required changes clearly.",
        ].join("\n\n");
        let finalReport = "";
        let verdict: ReturnType<typeof parseVerdict>;
        for (let revision = 0; revision <= MAX_PLAN_REVISIONS; revision++) {
          const plan = await readFeatureArtifact(ctx.cwd, workflow.id, "plan");
          finalReport = await runAgent(ctx, workflow, `architect-${revision + 1}`, [
            `Feature request:\n${workflow.request}`,
            `Scout report:\n${scout}`,
            `Proposed plan (JSON):\n${plan}`,
            ...(revision > 0 ? [`Previous architect feedback:\n${finalReport}`, "The plan has been revised once. Reassess it; do not request another revision unless genuinely blocked."] : []),
          ].join("\n\n"), {
            model: architectModel,
            thinkingLevel: architect.thinkingLevel ?? "high",
            systemPrompt: architectSystemPrompt,
          });
          verdict = parseVerdict(finalReport);
          if (!verdict) throw new Error("Architect output missing VERDICT: APPROVE, REVISE, or BLOCK line");
          if (verdict !== "revise" || revision === MAX_PLAN_REVISIONS) break;

          const revisedText = await runAgent(ctx, workflow, "plan-revision", [
            "You are a read-only planning agent. Do not create, modify, or delete files.",
            "Return only a JSON plan in a ```json code block, with summary and variable-length steps.",
            `Request:\n${workflow.request}`,
            `Scout report:\n${scout}`,
            `Current plan:\n${planArtifact}`,
            `Architect's required revisions:\n${finalReport}`,
          ].join("\n\n"), {});
          const revisedPlan = parsePlan(revisedText);
          workflow = await saveArtifact(ctx.cwd, workflow, "plan", `${JSON.stringify(revisedPlan, null, 2)}\n`, (current) => ({
            ...current,
            summary: revisedPlan.summary,
            steps: revisedPlan.steps.map((step, index) => ({
              id: `step-${index + 1}`,
              title: step.title,
              description: step.description,
              verification: step.verification,
              status: "pending",
            })),
          }));
        }

        workflow = await saveArtifact(ctx.cwd, workflow, "architect", finalReport, (current) => ({
          ...current,
          stage: verdict === "approve" ? "approval" : "architect",
          status: verdict === "approve" ? "awaiting_approval" : "blocked",
          lastError: verdict === "approve" ? undefined : `Architect verdict: ${verdict}`,
        }));
      }
      return workflow;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        workflow = await update(ctx.cwd, workflow, (current) => ({
          ...current,
          status: "failed",
          lastError: message,
        }));
      } catch {
        // Preserve original stage failure; stale state can be inspected and resumed manually.
      }
      throw error;
    }
  }

  function notifyWorkflow(ctx: ExtensionContext, workflow: FeatureWorkflow): void {
    if (workflow.status === "awaiting_approval") {
      ctx.ui.notify(`Plan ready for review. Run /feature show ${workflow.id}, then /feature approve ${workflow.id} or /feature reject ${workflow.id}.`, "info");
    } else if (workflow.status === "blocked" || workflow.status === "failed") {
      ctx.ui.notify(`Feature ${workflow.id} ${workflow.status}: ${workflow.lastError ?? "see artifacts"}. Resume with /feature resume ${workflow.id}.`, "error");
    } else {
      ctx.ui.notify(`Feature ${workflow.id}: ${workflow.stage}`, "info");
    }
  }

  pi.registerCommand("feature", {
    description: "Create, inspect, resume, approve, reject, or cancel a durable feature workflow",
    handler: async (args, ctx) => {
      const firstSpace = args.trim().indexOf(" ");
      const action = firstSpace < 0 ? args.trim().toLowerCase() : args.trim().slice(0, firstSpace).toLowerCase();
      const value = firstSpace < 0 ? "" : args.trim().slice(firstSpace + 1).trim();

      try {
        if (action === "start") {
          const input = splitTitleAndRequest(value);
          if (!input) {
            ctx.ui.notify("Usage: /feature start <title> :: <feature request>", "error");
            return;
          }
          const architectModel = findAgent(ctx.cwd, "architect")?.model;
          if (!architectModel) {
            ctx.ui.notify("Architect agent/model is not configured; feature workflow cannot start. No fallback will be used.", "error");
            return;
          }
          const workflow = await createFeatureWorkflow(ctx.cwd, {
            ...input,
            architectModel,
          });
          ctx.ui.notify(`Created feature workflow ${workflow.id}`, "info");
          notifyWorkflow(ctx, await runWorkflow(ctx, workflow));
          return;
        }

        if (action === "list") {
          const { workflows, errors } = await listFeatureWorkflows(ctx.cwd);
          const lines = workflows.map((workflow) =>
            `- ${workflow.id} — ${workflow.title} [${workflow.status}/${workflow.stage}]${workflow.approval === "approved" ? " approved" : ""}`,
          );
          if (errors.length) lines.push(...errors.map((entry) => `- ${entry.id} — unreadable: ${entry.message}`));
          pi.sendMessage({
            customType: "feature-workflow-list",
            content: [{ type: "text", text: lines.length ? lines.join("\n") : "No feature workflows found." }],
            display: true,
          }, { deliverAs: "steer", triggerTurn: false });
          return;
        }

        const id = value.split(/\s+/)[0];
        if (!id) {
          ctx.ui.notify("Usage: /feature <start|list|show|resume|approve|reject|cancel> [id]", "error");
          return;
        }
        let workflow = await readFeatureWorkflow(ctx.cwd, id);

        if (action === "show") {
          const artifacts = ["scout", "architect", "plan"] as const;
          const lines = [
            `## ${workflow.title} (${workflow.id})`,
            `Status: ${workflow.status} | Stage: ${workflow.stage} | Approval: ${workflow.approval}`,
            `Revision: ${workflow.revision} | Architect: ${workflow.architectModel || "not configured"}`,
            "",
            workflow.summary ?? workflow.request,
            "",
            ...workflow.steps.map((step, index) => `${index + 1}. [${step.status}] ${step.title} — ${step.description}`),
            workflow.lastError ? `\nLast error: ${workflow.lastError}` : "",
            "",
            ...await Promise.all(artifacts.filter((name) => workflow.artifacts[name]).map(async (name) =>
              `### ${name}\n\n${await readFeatureArtifact(ctx.cwd, id, name)}`,
            )),
          ].filter(Boolean);
          pi.sendMessage({
            customType: "feature-workflow-show",
            content: [{ type: "text", text: lines.join("\n") }],
            display: true,
          }, { deliverAs: "steer", triggerTurn: false });
          return;
        }

        if (action === "resume") {
          if (workflow.stage === "execution" && workflow.approval === "approved") {
            const firstUnfinished = workflow.steps.findIndex((step) => step.status !== "passed");
            const currentIndex = firstUnfinished < 0 ? workflow.steps.length : firstUnfinished;
            pi.appendEntry("plan-state", {
              task: workflow.request,
              summary: workflow.summary ?? "",
              steps: workflow.steps.map(({ title, description }) => ({ title, description })),
              currentIndex,
              featureId: workflow.id,
            });
            ctx.ui.notify(`Restored approved plan ${id}. Run /plan-next to continue${workflow.steps[firstUnfinished]?.status === "running" ? " (current step may have been interrupted)" : ""}.`, "info");
            return;
          }
          workflow = await runWorkflow(ctx, workflow);
          notifyWorkflow(ctx, workflow);
          return;
        }

        if (action === "approve") {
          if (workflow.stage !== "approval" || workflow.status !== "awaiting_approval") {
            ctx.ui.notify(`Feature ${id} is not waiting for plan approval.`, "error");
            return;
          }
          const approved = await ctx.ui.confirm("Approve feature plan?", formatPlan(workflow));
          if (!approved) return;
          workflow = await update(ctx.cwd, workflow, (current) => ({
            ...current,
            approval: "approved",
            stage: "execution",
            status: "active",
            currentStepIndex: 0,
            lastError: undefined,
          }));
          pi.appendEntry("plan-state", {
            task: workflow.request,
            summary: workflow.summary ?? "",
            steps: workflow.steps.map(({ title, description }) => ({ title, description })),
            currentIndex: 0,
            featureId: workflow.id,
          });
          ctx.ui.notify(`Plan approved. Run /plan-next to execute first step. Feature ${id} remains project-local.`, "info");
          return;
        }

        if (action === "reject") {
          if (workflow.stage !== "approval" || workflow.status !== "awaiting_approval") {
            ctx.ui.notify(`Feature ${id} is not waiting for plan approval.`, "error");
            return;
          }
          workflow = await update(ctx.cwd, workflow, (current) => ({
            ...current,
            approval: "rejected",
            status: "cancelled",
            lastError: "Plan rejected by user",
          }));
          ctx.ui.notify(`Feature ${id} rejected. Artifacts remain under plans/features/${id}/.`, "info");
          return;
        }

        if (action === "cancel") {
          const confirmed = await ctx.ui.confirm("Cancel feature workflow?", `${workflow.title}\n\nArtifacts will be kept under plans/features/${id}/.`);
          if (!confirmed) return;
          await update(ctx.cwd, workflow, (current) => ({
            ...current,
            status: "cancelled",
            lastError: undefined,
          }));
          ctx.ui.notify(`Feature ${id} cancelled; artifacts retained.`, "info");
          return;
        }

        ctx.ui.notify("Usage: /feature <start|list|show|resume|approve|reject|cancel> [id]", "error");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
