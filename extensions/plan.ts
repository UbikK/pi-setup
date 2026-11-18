import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hasVisibleTerminal, runSubagent } from "./terminal-spawn/index.ts";
import { readFeatureWorkflow, updateFeatureWorkflowLatest } from "./lib/feature-store";
import type { FeatureAgent, FeatureWorkflow } from "./lib/feature-store";
import { DEFAULT_AGENT_TOOLS, findAgent } from "./lib/agents-lib";
import type { AgentDefinition } from "./lib/agents-lib";

interface PlanStep {
  id?: string;
  title: string;
  description: string;
  agent?: FeatureAgent;
  projectPath?: string;
  targetPaths?: string[];
  dependsOn?: string[];
}

interface PlanState {
  task: string;
  summary: string;
  steps: PlanStep[];
  currentIndex: number;
  featureId?: string;
}

function pathContains(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function pathsOverlap(first: string, second: string): boolean {
  return pathContains(first, second) || pathContains(second, first);
}

function stepProjectPath(step: PlanStep, cwd: string): string {
  return resolve(cwd, step.projectPath ?? ".");
}

function stepConflictsWithRunning(
  workflow: FeatureWorkflow,
  step: PlanStep,
  stepIndex: number,
  cwd: string,
): string | undefined {
  const currentId = step.id ?? workflow.steps[stepIndex]?.id;
  const projectPath = stepProjectPath(step, cwd);
  for (const active of workflow.steps.filter((item, index) => item.status === "running" && index !== stepIndex)) {
    if (active.dependsOn?.includes(currentId ?? "")) {
      return `Step ${active.title} depends on this step and is already running`;
    }
    const activeProjectPath = resolve(cwd, active.projectPath ?? ".");
    const sameOrNestedProject = pathsOverlap(projectPath, activeProjectPath);
    if ((step.agent ?? "main") === "main" || (active.agent ?? "main") === "main") {
      if (sameOrNestedProject) return "Main-session work cannot overlap a running step in the same project";
      continue;
    }

    const targets = step.targetPaths ?? [];
    const activeTargets = active.targetPaths ?? [];
    if (targets.length === 0 || activeTargets.length === 0) {
      if (sameOrNestedProject) return "Concurrent work in the same project requires declared target paths";
      continue;
    }
    if (targets.some((target) => activeTargets.some((activeTarget) =>
      pathsOverlap(resolve(projectPath, target), resolve(activeProjectPath, activeTarget)),
    ))) {
      return `Target paths overlap with running step ${active.title}`;
    }
  }
  return undefined;
}

function nextReadyStepIndex(workflow: FeatureWorkflow): number {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  return workflow.steps.findIndex((step) =>
    (step.status === "pending" || step.status === "failed") &&
    (step.dependsOn ?? []).every((dependency) => byId.get(dependency)?.status === "passed"),
  );
}

function describeDependencies(workflow: FeatureWorkflow, step: PlanStep): string {
  const byId = new Map(workflow.steps.map((item, index) => [item.id, `${index + 1}. ${item.title}`]));
  return step.dependsOn?.map((id) => byId.get(id) ?? id).join(", ") || "none";
}

function featureStepBlockReason(
  workflow: FeatureWorkflow,
  step: PlanStep,
  stepIndex: number,
  cwd: string,
): string | undefined {
  if (workflow.approval !== "approved" || workflow.stage !== "execution") {
    return `Feature ${workflow.id} is not approved for execution`;
  }
  const current = workflow.steps[stepIndex];
  if (!current || (step.id !== undefined && current.id !== step.id)) {
    return "Plan step no longer matches persisted feature state; resume the feature";
  }
  if (current.status === "running") return `Step ${current.title} is already running`;
  if (current.status === "passed") return `Step ${current.title} is already complete`;
  if (current.status !== "pending" && current.status !== "failed") {
    return `Step ${current.title} cannot run from status ${current.status}`;
  }
  const byId = new Map(workflow.steps.map((item) => [item.id, item]));
  const unmet = current.dependsOn?.find((dependency) => byId.get(dependency)?.status !== "passed");
  if (unmet) return `Step depends on unfinished step ${byId.get(unmet)?.title ?? unmet}`;
  return stepConflictsWithRunning(workflow, step, stepIndex, cwd);
}

function resolveImplementationAgent(
  ctx: ExtensionContext,
  name: Exclude<FeatureAgent, "main">,
  projectPath: string,
): { definition: AgentDefinition; tools: string[] } {
  const definition = findAgent(projectPath, name);
  const tools = definition?.tools ?? DEFAULT_AGENT_TOOLS;
  if (!definition || !tools.includes("edit") || !tools.includes("write")) {
    throw new Error(`Agent ${name} is unavailable or lacks edit/write tools in ${projectPath}`);
  }
  if (definition.model) {
    const separator = definition.model.indexOf("/");
    if (separator <= 0 || separator === definition.model.length - 1) {
      throw new Error(`Agent ${name} has invalid model setting: ${definition.model}`);
    }
    const model = ctx.modelRegistry.find(definition.model.slice(0, separator), definition.model.slice(separator + 1));
    if (!model) throw new Error(`Agent ${name} model is not available: ${definition.model}`);
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
      throw new Error(`Agent ${name} model has no configured authentication: ${definition.model}`);
    }
  }
  return { definition, tools };
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

  async function launchImplementationStep(
    ctx: ExtensionContext,
    workflow: FeatureWorkflow,
    step: PlanStep,
    stepNumber: number,
    runId: string,
    definition: AgentDefinition,
    tools: string[],
  ): Promise<void> {
    const projectPath = stepProjectPath(step, ctx.cwd);
    const scratchDir = join(ctx.cwd, ".pi", "scratch");
    const outputFile = join(scratchDir, `feature-${workflow.id}-${step.id ?? `step-${stepNumber}`}-${runId}.md`);
    const systemPromptFile = `${outputFile}.system.md`;
    try {
      await mkdir(scratchDir, { recursive: true });
      await writeFile(systemPromptFile, [
        definition.systemPrompt,
        "For this approved task, edit only declared target paths in the requested project. Do not start another plan step.",
      ].join("\n\n"), "utf8");
      const prompt = [
        "APPROVED FEATURE STEP:",
        `Feature: ${workflow.title} (${workflow.id})`,
        `Step ${stepNumber}/${workflow.steps.length}: ${step.title}`,
        `Project: ${projectPath}`,
        `Target paths: ${step.targetPaths?.join(", ") || "unspecified"}`,
        `Dependencies: ${step.dependsOn?.join(", ") || "none"}`,
        "Implement only this approved step. Do not proceed to later steps.",
        "",
        step.description,
      ].join("\n");
      await updateFeatureWorkflowLatest(ctx.cwd, workflow.id, (current) => ({
        ...current,
        steps: current.steps.map((item) =>
          item.id === step.id && item.runId === runId && item.status === "running"
            ? {
              ...item,
              workerHost: hostname(),
              workerOutputFile: outputFile,
              workerMetaFile: `${outputFile}.meta`,
              startedAt: new Date().toISOString(),
            }
            : item,
        ),
      }));
      const result = await runSubagent(pi, {
        ctx,
        cwd: projectPath,
        command: [
          "pi", "-p", "--no-session", "--no-extensions",
          "--thinking", definition.thinkingLevel ?? "low",
          ...(definition.model ? ["--model", definition.model] : []),
          "--tools", tools.join(","),
          "--append-system-prompt", systemPromptFile,
          prompt,
        ],
        outputFile,
        label: `${definition.name}: ${step.title.slice(0, 40)}`,
        timeoutMs: 600_000,
        requireTerminal: true,
        onStart: async (worker) => {
          await updateFeatureWorkflowLatest(ctx.cwd, workflow.id, (current) => {
            const activeRun = current.steps.find((item) => item.id === step.id);
            if (
              current.approval !== "approved" ||
              current.stage !== "execution" ||
              current.status === "cancelled" ||
              activeRun?.status !== "running" ||
              activeRun.runId !== runId
            ) {
              throw new Error("Approved step is no longer active; refusing to start worker");
            }
            return {
              ...current,
              steps: current.steps.map((item) =>
                item.id === step.id && item.runId === runId && item.status === "running"
                  ? {
                    ...item,
                    workerPid: worker.pid,
                    workerHost: worker.host,
                    workerBackend: worker.backend,
                    paneRef: worker.paneRef,
                    workerOutputFile: worker.outputFile,
                    workerMetaFile: worker.metaFile,
                    startedAt: new Date().toISOString(),
                  }
                  : item,
              ),
            };
          });
        },
      });
      const success = result.exitCode === 0 && result.output.trim().length > 0;
      const status = success ? "passed" : "failed";
      const summary = result.output.trim().slice(-8000) || `Agent exited with code ${result.exitCode} and no output`;
      await updateFeatureWorkflowLatest(ctx.cwd, workflow.id, (current) => ({
        ...current,
        steps: current.steps.map((item) =>
          item.id === step.id && item.runId === runId && item.status === "running"
            ? {
              ...item,
              status,
              result: summary,
              workerPid: undefined,
              workerHost: undefined,
              workerBackend: undefined,
              paneRef: undefined,
              workerOutputFile: undefined,
              workerMetaFile: undefined,
              startedAt: undefined,
            }
            : item,
        ),
      }));
      ctx.ui.notify(`${definition.name} ${success ? "completed" : "failed"} step ${stepNumber}: ${step.title}`, success ? "info" : "error");
      pi.sendMessage({
        customType: "feature-step-result",
        content: [{ type: "text", text: [
          `## ${definition.name} ${success ? "completed" : "failed"} — ${step.title}`,
          `Feature: ${workflow.id} | Project: ${projectPath}`,
          "",
          summary,
          "",
          "No further steps were started. Review result, then approve next step with /plan-next.",
        ].join("\n") }],
        display: true,
      }, { deliverAs: "steer", triggerTurn: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminationUnconfirmed = message.includes("Worker termination failed") || message.includes("worker remains alive") || message.includes("Worker ownership cannot be verified");
      try {
        await updateFeatureWorkflowLatest(ctx.cwd, workflow.id, (current) => ({
          ...current,
          steps: current.steps.map((item) =>
            item.id === step.id && item.runId === runId && item.status === "running"
              ? {
                ...item,
                status: terminationUnconfirmed ? "running" : "failed",
                result: message.slice(-8000),
                ...(terminationUnconfirmed ? {} : {
                  workerPid: undefined,
                  workerHost: undefined,
                  workerBackend: undefined,
                  paneRef: undefined,
                  workerOutputFile: undefined,
                  workerMetaFile: undefined,
                  startedAt: undefined,
                }),
              }
              : item,
          ),
        }));
      } catch (stateError) {
        ctx.ui.notify(`Could not persist ${definition.name} failure: ${stateError instanceof Error ? stateError.message : String(stateError)}`, "error");
      }
      ctx.ui.notify(`${definition.name} failed step ${stepNumber}: ${message}`, "error");
      pi.sendMessage({
        customType: "feature-step-result",
        content: [{ type: "text", text: `## ${definition.name} failed — ${step.title}\n\nFeature: ${workflow.id} | Project: ${projectPath}\n\n${message}\n\nNo further steps were started. Review failure, then retry with /feature resume ${workflow.id}.` }],
        display: true,
      }, { deliverAs: "steer", triggerTurn: false });
    } finally {
      await Promise.all([
        unlink(systemPromptFile).catch(() => {}),
        unlink(outputFile).catch(() => {}),
      ]);
    }
  }

  function extractJson<T = unknown>(text: string): T {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    const raw = match ? match[1] : text;
    return JSON.parse(raw);
  }

  async function handleFeaturePlanNext(plan: PlanState, ctx: ExtensionContext): Promise<void> {
    if (!plan.featureId) throw new Error("Feature id is required");
    let workflow = await readFeatureWorkflow(ctx.cwd, plan.featureId);
    if (workflow.approval !== "approved" || workflow.stage !== "execution") {
      ctx.ui.notify(`Feature ${workflow.id} has no approved plan; refusing execution.`, "error");
      return;
    }

    if (workflow.steps.some((step) => step.status === "running" && (step.agent ?? "main") === "main")) {
      workflow = await updateFeatureWorkflowLatest(ctx.cwd, workflow.id, (current) => ({
        ...current,
        steps: current.steps.map((step) =>
          step.status === "running" && (step.agent ?? "main") === "main"
            ? { ...step, status: "passed" }
            : step,
        ),
      }));
    }

    const stepIndex = nextReadyStepIndex(workflow);
    if (stepIndex < 0) {
      const active = workflow.steps.filter((step) => step.status === "running");
      if (active.length > 0) {
        ctx.ui.notify(`Waiting for active steps: ${active.map((step) => `${step.agent ?? "main"} (${step.title})`).join(", ")}`, "info");
        return;
      }
      if (workflow.steps.every((step) => step.status === "passed" || step.status === "skipped")) {
        const completed = await updateFeatureWorkflowLatest(ctx.cwd, workflow.id, (current) => ({
          ...current,
          stage: "complete",
          status: "completed",
          currentStepIndex: current.steps.length,
        }));
        ctx.ui.notify(`Feature ${completed.id} plan complete.`, "info");
        return;
      }
      ctx.ui.notify(`Feature ${workflow.id} has steps blocked by unfinished dependencies or failures. Inspect with /feature show ${workflow.id}.`, "warning");
      return;
    }

    const persistedStep = workflow.steps[stepIndex];
    const step: PlanStep = {
      id: persistedStep.id,
      title: persistedStep.title,
      description: persistedStep.description,
      agent: persistedStep.agent ?? "main",
      projectPath: persistedStep.projectPath ?? ctx.cwd,
      targetPaths: persistedStep.targetPaths ?? [],
      dependsOn: persistedStep.dependsOn ?? [],
    };
    const blocked = featureStepBlockReason(workflow, step, stepIndex, ctx.cwd);
    if (blocked) {
      ctx.ui.notify(blocked, "warning");
      return;
    }

    const agentName = step.agent ?? "main";
    const projectPath = stepProjectPath(step, ctx.cwd);
    let agent: { definition: AgentDefinition; tools: string[] } | undefined;
    if (agentName !== "main") {
      try {
        const project = await stat(projectPath);
        if (!project.isDirectory()) throw new Error(`Step project is not a directory: ${projectPath}`);
        agent = resolveImplementationAgent(ctx, agentName, projectPath);
        if (!(await hasVisibleTerminal(pi))) {
          throw new Error("A visible cmux or Ghostty terminal is required; no agent was started");
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }
    }

    const details = [
      `Executor: ${agentName}`,
      `Project: ${projectPath}`,
      `Target paths: ${step.targetPaths?.join(", ") || "unspecified"}`,
      `Agent tools: ${agent?.tools.join(", ") || (agentName === "main" ? "main session tools" : "not applicable")}`,
      `Depends on: ${describeDependencies(workflow, step)}`,
      "",
      step.description,
      ...(persistedStep.status === "failed" ? ["", `Previous attempt failed: ${persistedStep.result ?? "see feature state"}`] : []),
    ].join("\n");
    const confirmed = await ctx.ui.confirm(
      `Step ${stepIndex + 1}/${workflow.steps.length} — ${agentName}`,
      `${details}\n\nProceed with this step only?`,
    );
    if (!confirmed) return;

    const runId = agent ? randomUUID() : undefined;
    try {
      workflow = await updateFeatureWorkflowLatest(ctx.cwd, workflow.id, (current) => {
        const latestBlock = featureStepBlockReason(current, step, stepIndex, ctx.cwd);
        if (latestBlock) throw new Error(latestBlock);
        return {
          ...current,
          currentStepIndex: Math.max(current.currentStepIndex ?? 0, stepIndex + 1),
          steps: current.steps.map((item, index) => index === stepIndex
            ? { ...item, status: "running", runId }
            : item),
        };
      });
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      return;
    }

    savePlan({
      ...plan,
      currentIndex: Math.max(plan.currentIndex, stepIndex + 1),
      steps: workflow.steps.map(({ id, title, description, agent, projectPath, targetPaths, dependsOn }) => ({
        id, title, description, agent: agent ?? "main", projectPath: projectPath ?? ctx.cwd,
        targetPaths: targetPaths ?? [], dependsOn: dependsOn ?? [],
      })),
    });

    if (agent && runId) {
      ctx.ui.notify(`Starting ${agent.definition.name} in its own terminal (${projectPath})`, "info");
      void launchImplementationStep(ctx, workflow, step, stepIndex + 1, runId, agent.definition, agent.tools);
      return;
    }

    pi.sendUserMessage([
      `Execute this approved plan step (step ${stepIndex + 1} of ${workflow.steps.length}):`,
      "",
      `**${step.title}**`,
      step.description,
    ].join("\n"));
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
      if (plan.featureId) {
        try {
          await handleFeaturePlanNext(plan, ctx);
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      if (plan.currentIndex >= plan.steps.length) {
        ctx.ui.notify("Plan complete.", "info");
        return;
      }

      const stepIndex = plan.currentIndex;
      const step = plan.steps[stepIndex];
      const confirmed = await ctx.ui.confirm(
        `Step ${stepIndex + 1}/${plan.steps.length}`,
        `${step.title}\n\n${step.description}\n\nProceed?`,
      );
      if (!confirmed) return;

      savePlan({ ...plan, currentIndex: stepIndex + 1 });
      pi.sendUserMessage(
        [
          `Execute this plan step (step ${stepIndex + 1} of ${plan.steps.length}):`,
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
