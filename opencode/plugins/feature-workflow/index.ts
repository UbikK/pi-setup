import { isAbsolute, resolve } from "node:path";
import { stat } from "node:fs/promises";
import {
  createFeatureWorkflow,
  listFeatureWorkflows,
  readFeatureArtifact,
  readFeatureWorkflow,
  updateFeatureWorkflow,
  writeFeatureArtifact,
} from "./feature-store.ts";
import type {
  FeatureAgent,
  FeatureArtifact,
  FeatureWorkflow,
} from "./feature-store.ts";

type PlanStepOutput = {
  title: string;
  description: string;
  verification?: string[];
  agent?: FeatureAgent;
  projectPath?: string;
  targetPaths?: string[];
  dependsOn?: number[];
};

type PlanOutput = { summary: string; steps: PlanStepOutput[] };
type AgentId = "explore" | "plan" | "architect" | "build" | "backend-engineer" | "frontend-engineer";
type CommandContext = {
  location: { directory: string };
  command: { transform(callback: (editor: { add(definition: Record<string, unknown>): void }) => void): Promise<{ dispose(): Promise<void> }> };
  session: {
    create(input: { directory: string; parentID?: string; title?: string }): Promise<{ id: string }>;
    prompt(input: { sessionID: string; text: string; agent?: string; delivery?: string }): Promise<unknown>;
    synthetic(input: { sessionID: string; text: string }): Promise<unknown>;
    context(input: { sessionID: string }): Promise<unknown>;
  };
  agent: { get(input: { agentID: string }): Promise<unknown> };
};

const ARCHITECT_MODEL = "gaio/gpt-6.1-terra#high";
const MAX_PLAN_REVISIONS = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parsePlanText(text: string): PlanOutput {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const parsed: unknown = JSON.parse(fenced?.[1] ?? text);
  if (!isRecord(parsed) || typeof parsed.summary !== "string" || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error("Planner output must contain a summary and at least one step");
  }

  const validAgents: FeatureAgent[] = ["frontend-engineer", "backend-engineer", "main"];
  const steps = parsed.steps.map((value, index): PlanStepOutput => {
    if (!isRecord(value) || typeof value.title !== "string" || typeof value.description !== "string") {
      throw new Error(`Planner step ${index + 1} must include title and description`);
    }
    if (value.agent !== undefined && !validAgents.includes(value.agent as FeatureAgent)) {
      throw new Error(`Planner step ${index + 1} has unsupported agent: ${String(value.agent)}`);
    }
    if (value.projectPath !== undefined && typeof value.projectPath !== "string") {
      throw new Error(`Planner step ${index + 1} has invalid projectPath`);
    }
    if (value.targetPaths !== undefined && !isStringArray(value.targetPaths)) {
      throw new Error(`Planner step ${index + 1} targetPaths must be strings`);
    }
    if (value.verification !== undefined && !isStringArray(value.verification)) {
      throw new Error(`Planner step ${index + 1} verification must be strings`);
    }

    const dependsOn = value.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || !dependsOn.every((step) => Number.isInteger(step) && step >= 1 && step <= index)) {
      throw new Error(`Planner step ${index + 1} dependencies must refer to earlier steps`);
    }
    const targetPaths = (value.targetPaths as string[] | undefined) ?? [];
    if (targetPaths.some((path) => !path.trim() || isAbsolute(path) || path.split(/[\\/]+/).includes(".."))) {
      throw new Error(`Planner step ${index + 1} targetPaths must be relative paths without '..'`);
    }

    return {
      title: value.title,
      description: value.description,
      verification: value.verification as string[] | undefined,
      agent: value.agent as FeatureAgent | undefined,
      projectPath: value.projectPath as string | undefined,
      targetPaths,
      dependsOn: dependsOn as number[],
    };
  });
  return { summary: parsed.summary, steps };
}

async function normalizePlan(plan: PlanOutput, directory: string, context: CommandContext): Promise<PlanOutput> {
  const steps = await Promise.all(plan.steps.map(async (step, index) => {
    const projectPath = resolve(directory, step.projectPath ?? ".");
    let projectStat;
    try {
      projectStat = await stat(projectPath);
    } catch {
      throw new Error(`Planner step ${index + 1} project path does not exist: ${projectPath}`);
    }
    if (!projectStat.isDirectory()) throw new Error(`Planner step ${index + 1} project path is not a directory`);

    const agent = step.agent ?? "main";
    if (agent === "main" && projectPath !== resolve(directory)) {
      throw new Error(`Planner step ${index + 1} targets another project; assign a named specialist`);
    }
    if (agent !== "main") {
      const available = await context.agent.get({ agentID: agent });
      if (!available) throw new Error(`OpenCode agent is unavailable: ${agent}`);
    }
    return { ...step, agent, projectPath, targetPaths: step.targetPaths ?? [], dependsOn: step.dependsOn ?? [] };
  }));
  return { ...plan, steps };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n");
  if (!isRecord(value)) return "";
  if (value.type === "text" && typeof value.text === "string") return value.text;
  for (const key of ["parts", "content", "messages"]) {
    if (Array.isArray(value[key])) {
      const text = extractText(value[key]);
      if (text) return text;
    }
  }
  if (isRecord(value.info) && value.info.role === "assistant") return extractText(value.parts);
  if (typeof value.text === "string") return value.text;
  return "";
}

async function runAgent(
  context: CommandContext,
  parentSessionID: string,
  directory: string,
  workflow: FeatureWorkflow,
  label: string,
  agent: AgentId,
  prompt: string,
): Promise<string> {
  const session = await context.session.create({
    directory,
    parentID: parentSessionID,
    title: `feature ${workflow.id}: ${label}`,
  });
  const result = await context.session.prompt({ sessionID: session.id, agent, text: prompt });
  const direct = extractText(result).trim();
  if (direct) return direct;

  const messages = await context.session.context({ sessionID: session.id });
  const transcript = Array.isArray(messages) ? messages : [];
  for (let index = transcript.length - 1; index >= 0; index--) {
    const entry = transcript[index];
    if (isRecord(entry) && isRecord(entry.info) && entry.info.role === "assistant") {
      const response = extractText(entry.parts).trim();
      if (response) return response;
    }
  }
  throw new Error(`${label} agent returned no text`);
}

async function saveArtifact(
  directory: string,
  workflow: FeatureWorkflow,
  artifact: FeatureArtifact,
  content: string,
  patch: (current: FeatureWorkflow) => FeatureWorkflow,
): Promise<FeatureWorkflow> {
  const path = await writeFeatureArtifact(directory, workflow.id, artifact, content);
  return updateFeatureWorkflow(directory, workflow.id, workflow.revision, (current) => patch({
    ...current,
    artifacts: { ...current.artifacts, [artifact]: path },
  }));
}

function parseVerdict(text: string): "approve" | "revise" | "block" | undefined {
  const match = text.match(/^\s*VERDICT:\s*(APPROVE|REVISE|BLOCK)\s*$/im);
  return match?.[1].toLowerCase() as "approve" | "revise" | "block" | undefined;
}

function parseStart(value: string): { title: string; request: string } | undefined {
  const separator = value.indexOf(" :: ");
  if (separator < 1) return undefined;
  const title = value.slice(0, separator).trim();
  const request = value.slice(separator + 4).trim();
  return title && request ? { title, request } : undefined;
}

function formatPlan(workflow: FeatureWorkflow, directory: string): string {
  const names = new Map(workflow.steps.map((step, index) => [step.id, `${index + 1}. ${step.title}`]));
  const steps = workflow.steps.map((step, index) => [
    `${index + 1}. **${step.title}** — ${step.description}`,
    `   Executor: ${step.agent ?? "main"} | Project: ${step.projectPath ?? directory}`,
    `   Targets: ${step.targetPaths?.join(", ") || "unspecified"} | Depends on: ${step.dependsOn?.map((id) => names.get(id) ?? id).join(", ") || "none"}`,
  ].join("\n"));
  return [`## ${workflow.title} (${workflow.id})`, "", workflow.summary ?? workflow.request, "", ...steps].join("\n");
}

async function runWorkflow(
  context: CommandContext,
  parentSessionID: string,
  directory: string,
  initial: FeatureWorkflow,
): Promise<FeatureWorkflow> {
  let workflow = initial;
  try {
    if (workflow.status === "cancelled" || workflow.status === "completed") {
      throw new Error(`Cannot resume a ${workflow.status} feature`);
    }
    if (workflow.stage === "approval" && workflow.status === "awaiting_approval") return workflow;
    if (workflow.status !== "active") {
      workflow = await updateFeatureWorkflow(directory, workflow.id, workflow.revision, (current) => ({
        ...current, status: "active", lastError: undefined,
      }));
    }

    if (workflow.stage === "scout") {
      const scout = await runAgent(context, parentSessionID, directory, workflow, "explore", "explore", [
        "Explore the project read-only. Do not edit, create, or delete files.",
        "Return exactly these sections: Summary; Likely files/modules to touch; Risks or blockers; Unknowns; Suggested first step.",
        `Feature request:\n${workflow.request}`,
      ].join("\n\n"));
      workflow = await saveArtifact(directory, workflow, "scout", scout, (current) => ({
        ...current, stage: "plan", status: "active", lastError: undefined,
      }));
    }

    if (workflow.stage === "plan") {
      const scout = await readFeatureArtifact(directory, workflow.id, "scout");
      const planText = await runAgent(context, parentSessionID, directory, workflow, "plan", "plan", [
        "You are a read-only planning agent. Do not edit project files.",
        "Return one JSON object in a ```json block: {summary:string, steps:[{title:string, description:string, verification:string[], agent:'frontend-engineer'|'backend-engineer'|'main', projectPath:string, targetPaths:string[], dependsOn:number[]}]}.",
        "Return all fields for every step. Use projectPath '.' unless the request explicitly names another existing project. Assign frontend-engineer to UI/client work, backend-engineer to API/server/data work, and main to cross-cutting work.",
        "targetPaths are likely relative paths or []; dependsOn contains 1-based earlier step numbers only. Keep steps reviewable and independently verifiable; shared targets or prerequisite work must be represented as dependencies.",
        `Request:\n${workflow.request}`,
        `Scout report:\n${scout}`,
      ].join("\n\n"));
      const plan = await normalizePlan(parsePlanText(planText), directory, context);
      workflow = await saveArtifact(directory, workflow, "plan", `${JSON.stringify(plan, null, 2)}\n`, (current) => ({
        ...current,
        stage: "architect",
        status: "active",
        summary: plan.summary,
        steps: plan.steps.map((step, index) => ({
          id: `step-${index + 1}`,
          title: step.title,
          description: step.description,
          verification: step.verification,
          agent: step.agent,
          projectPath: step.projectPath,
          targetPaths: step.targetPaths,
          dependsOn: step.dependsOn?.map((dependency) => `step-${dependency}`),
          status: "pending",
        })),
        lastError: undefined,
      }));
    }

    if (workflow.stage === "architect") {
      const architect = await context.agent.get({ agentID: "architect" });
      if (!architect) throw new Error("OpenCode architect agent is missing; no fallback will be used");
      const scout = await readFeatureArtifact(directory, workflow.id, "scout");
      let report = "";
      let verdict: ReturnType<typeof parseVerdict>;
      for (let revision = 0; revision <= MAX_PLAN_REVISIONS; revision++) {
        const plan = await readFeatureArtifact(directory, workflow.id, "plan");
        report = await runAgent(context, parentSessionID, directory, workflow, `architect-${revision + 1}`, "architect", [
          "Review the proposed plan. Read-only: do not edit, create, or delete files.",
          "Review executor assignments, project paths, target scopes, and dependency assumptions.",
          "End with exactly one machine-readable line: VERDICT: APPROVE, VERDICT: REVISE, or VERDICT: BLOCK. Use REVISE only for concrete changes; use BLOCK for fundamental blockers.",
          `Feature request:\n${workflow.request}`,
          `Scout report:\n${scout}`,
          `Plan JSON:\n${plan}`,
          ...(revision > 0 ? [`Previous architect feedback:\n${report}`, "The plan was revised once. Do not request another revision unless blocked."] : []),
        ].join("\n\n"));
        verdict = parseVerdict(report);
        if (!verdict) throw new Error("Architect response must end with a VERDICT line");
        if (verdict !== "revise" || revision === MAX_PLAN_REVISIONS) break;

        const revisedText = await runAgent(context, parentSessionID, directory, workflow, "plan-revision", "plan", [
          "You are a read-only planning agent. Return only one JSON plan in a ```json block, preserving this schema: summary and variable-length steps with title, description, verification, agent, projectPath, targetPaths, and dependsOn.",
          `Request:\n${workflow.request}`,
          `Scout report:\n${scout}`,
          `Current plan:\n${plan}`,
          `Architect feedback:\n${report}`,
        ].join("\n\n"));
        const revised = await normalizePlan(parsePlanText(revisedText), directory, context);
        workflow = await saveArtifact(directory, workflow, "plan", `${JSON.stringify(revised, null, 2)}\n`, (current) => ({
          ...current,
          summary: revised.summary,
          steps: revised.steps.map((step, index) => ({
            id: `step-${index + 1}`,
            title: step.title,
            description: step.description,
            verification: step.verification,
            agent: step.agent,
            projectPath: step.projectPath,
            targetPaths: step.targetPaths,
            dependsOn: step.dependsOn?.map((dependency) => `step-${dependency}`),
            status: "pending",
          })),
        }));
      }

      workflow = await saveArtifact(directory, workflow, "architect", report, (current) => ({
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
      workflow = await updateFeatureWorkflow(directory, workflow.id, workflow.revision, (current) => ({
        ...current, status: "failed", lastError: message,
      }));
    } catch {
      // Preserve the original stage failure; the saved revision remains inspectable.
    }
    throw error;
  }
}

function showWorkflow(workflow: FeatureWorkflow, directory: string): string {
  const lines = [
    `## ${workflow.title} (${workflow.id})`,
    `Status: ${workflow.status} | Stage: ${workflow.stage} | Approval: ${workflow.approval}`,
    `Revision: ${workflow.revision} | Architect model: ${workflow.architectModel}`,
    "",
    workflow.summary ?? workflow.request,
    `Last error: ${workflow.lastError ?? "none"}`,
    "",
    ...workflow.steps.map((step, index) =>
      `${index + 1}. [${step.status}] ${step.title} — ${step.description} | executor: ${step.agent ?? "main"} | project: ${step.projectPath ?? directory} | targets: ${step.targetPaths?.join(", ") || "unspecified"} | depends on: ${step.dependsOn?.join(", ") || "none"}`,
    ),
  ];
  return lines.join("\n");
}

async function executeNext(
  context: CommandContext,
  parentSessionID: string,
  directory: string,
  workflow: FeatureWorkflow,
): Promise<string> {
  if (workflow.approval !== "approved" || workflow.stage !== "execution") {
    throw new Error(`Feature ${workflow.id} is not approved for execution`);
  }
  const index = workflow.steps.findIndex((step) => step.status !== "passed");
  if (index < 0) {
    await updateFeatureWorkflow(directory, workflow.id, workflow.revision, (current) => ({
      ...current, stage: "complete", status: "completed", currentStepIndex: current.steps.length,
    }));
    return `Feature ${workflow.id} is complete.`;
  }

  const step = workflow.steps[index];
  const incompleteDependency = (step.dependsOn ?? []).find((dependency) =>
    workflow.steps.find((candidate) => candidate.id === dependency)?.status !== "passed",
  );
  if (incompleteDependency) throw new Error(`Step ${index + 1} depends on unfinished ${incompleteDependency}`);

  await updateFeatureWorkflow(directory, workflow.id, workflow.revision, (current) => ({
    ...current,
    status: "active",
    currentStepIndex: index,
    lastError: undefined,
    steps: current.steps.map((candidate, candidateIndex) => candidateIndex === index
      ? { ...candidate, status: "running" }
      : candidate),
  }));

  const agent: AgentId = step.agent === "backend-engineer" || step.agent === "frontend-engineer"
    ? step.agent
    : "build";
  const task = [
    `APPROVED FEATURE STEP: ${step.title}`,
    `Execute feature step ${index + 1} of ${workflow.steps.length}.`,
    "Only work on this step. Do not begin later steps.",
    `Feature: ${workflow.title}`,
    `Approved request: ${workflow.request}`,
    `Step: ${step.title}`,
    step.description,
    `Project: ${step.projectPath ?? directory}`,
    `Target paths: ${step.targetPaths?.join(", ") || "unspecified"}`,
    `Verification: ${step.verification?.join("; ") || "report checks run and remaining verification"}`,
  ].join("\n\n");

  try {
    const result = await runAgent(context, parentSessionID, step.projectPath ?? directory, workflow, `step-${index + 1}`, agent, task);
    const latest = await readFeatureWorkflow(directory, workflow.id);
    const updated = await updateFeatureWorkflow(directory, workflow.id, latest.revision, (current) => {
      const steps = current.steps.map((candidate, candidateIndex) => candidateIndex === index
        ? { ...candidate, status: "passed", result }
        : candidate);
      const complete = steps.every((candidate) => candidate.status === "passed");
      return {
        ...current,
        status: complete ? "completed" : "active",
        stage: complete ? "complete" : "execution",
        currentStepIndex: complete ? steps.length : index + 1,
        steps,
      };
    });
    return `Step ${index + 1}/${workflow.steps.length} passed: ${step.title}\n\n${result}\n\n${updated.status === "completed" ? `Feature ${workflow.id} is complete.` : `Run /feature next ${workflow.id} to execute the next approved step.`}`;
  } catch (error) {
    const latest = await readFeatureWorkflow(directory, workflow.id);
    const message = error instanceof Error ? error.message : String(error);
    await updateFeatureWorkflow(directory, workflow.id, latest.revision, (current) => ({
      ...current,
      status: "failed",
      lastError: message,
      steps: current.steps.map((candidate, candidateIndex) => candidateIndex === index
        ? { ...candidate, status: "failed", result: message }
        : candidate),
    }));
    throw error;
  }
}

async function handleCommand(
  context: CommandContext,
  sessionID: string,
  args: string,
): Promise<string> {
  const input = args.trim().replace(/^\/feature\b/i, "").trim();
  const split = input.indexOf(" ");
  const action = (split < 0 ? input : input.slice(0, split)).toLowerCase();
  const value = split < 0 ? "" : input.slice(split + 1).trim();
  const directory = context.location.directory;

  if (action === "start") {
    const parsed = parseStart(value);
    if (!parsed) return "Usage: /feature start <title> :: <feature request>";
    const architect = await context.agent.get({ agentID: "architect" });
    if (!architect) throw new Error("OpenCode architect agent is not configured; no fallback will be used");
    let workflow = await createFeatureWorkflow(directory, { ...parsed, architectModel: ARCHITECT_MODEL });
    workflow = await runWorkflow(context, sessionID, directory, workflow);
    return workflow.status === "awaiting_approval"
      ? `${showWorkflow(workflow, directory)}\n\nReview artifacts with /feature show ${workflow.id}. Approve with /feature approve ${workflow.id}, or reject with /feature reject ${workflow.id}.`
      : `${showWorkflow(workflow, directory)}\n\nWorkflow paused at ${workflow.stage}. Resume with /feature resume ${workflow.id}.`;
  }

  if (action === "list") {
    const { workflows, errors } = await listFeatureWorkflows(directory);
    const entries = workflows.map((workflow) =>
      `- ${workflow.id} — ${workflow.title} [${workflow.status}/${workflow.stage}]${workflow.approval === "approved" ? " approved" : ""}`,
    );
    entries.push(...errors.map((entry) => `- ${entry.id} — unreadable: ${entry.message}`));
    return entries.length ? entries.join("\n") : "No feature workflows found.";
  }

  const id = value.split(/\s+/)[0];
  if (!id) return "Usage: /feature <start|list|show|resume|approve|reject|cancel|next> [id]";
  let workflow = await readFeatureWorkflow(directory, id);

  if (action === "show") {
    const artifacts = ["scout", "plan", "architect"] as const;
    const sections = await Promise.all(artifacts.filter((artifact) => workflow.artifacts[artifact]).map(async (artifact) =>
      `### ${artifact}\n\n${await readFeatureArtifact(directory, id, artifact)}`,
    ));
    return `${showWorkflow(workflow, directory)}\n\n${sections.join("\n\n")}`;
  }

  if (action === "resume") {
    if (workflow.stage === "execution" && workflow.approval === "approved") {
      const step = workflow.steps.find((candidate) => candidate.status !== "passed");
      return `Restored approved feature ${id}. ${step?.status === "running" || step?.status === "failed" ? `Step ${step.title} may be interrupted and will be retried.` : ""} Run /feature next ${id} to continue.`;
    }
    workflow = await runWorkflow(context, sessionID, directory, workflow);
    return showWorkflow(workflow, directory);
  }

  if (action === "approve") {
    if (workflow.stage !== "approval" || workflow.status !== "awaiting_approval") {
      throw new Error(`Feature ${id} is not waiting for plan approval`);
    }
    workflow = await updateFeatureWorkflow(directory, id, workflow.revision, (current) => ({
      ...current, approval: "approved", stage: "execution", status: "active", currentStepIndex: 0, lastError: undefined,
    }));
    return `Plan approved.\n\n${formatPlan(workflow, directory)}\n\nRun /feature next ${id} to execute one step.`;
  }

  if (action === "reject") {
    if (workflow.stage !== "approval" || workflow.status !== "awaiting_approval") {
      throw new Error(`Feature ${id} is not waiting for plan approval`);
    }
    await updateFeatureWorkflow(directory, id, workflow.revision, (current) => ({
      ...current, approval: "rejected", status: "cancelled", lastError: "Plan rejected by user",
    }));
    return `Feature ${id} rejected. Artifacts remain under plans/features/${id}/.`;
  }

  if (action === "cancel") {
    if (workflow.status === "completed" || workflow.status === "cancelled") return `Feature ${id} is already ${workflow.status}.`;
    await updateFeatureWorkflow(directory, id, workflow.revision, (current) => ({
      ...current, status: "cancelled", lastError: undefined,
    }));
    return `Feature ${id} cancelled. Artifacts remain under plans/features/${id}/.`;
  }

  if (action === "next") return executeNext(context, sessionID, directory, workflow);
  return "Usage: /feature <start|list|show|resume|approve|reject|cancel|next> [id]";
}

export default {
  id: "feature-workflow",
  async setup(context: CommandContext) {
    const registration = await context.command.transform((editor) => {
      editor.add({
        name: "feature",
        description: "Create, inspect, resume, approve, reject, cancel, and execute durable feature workflows",
        execute: async ({ sessionID, prompt }: { sessionID: string; prompt: { text: string } }) => {
          let result: string;
          try {
            result = await handleCommand(context, sessionID, prompt.text);
          } catch (error) {
            result = `Feature workflow failed: ${error instanceof Error ? error.message : String(error)}`;
          }
          await context.session.synthetic({ sessionID, text: result });
        },
      });
    });
    return () => registration.dispose();
  },
};
