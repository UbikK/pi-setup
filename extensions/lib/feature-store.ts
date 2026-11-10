import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";

export const FEATURE_STATE_VERSION = 1;

export type FeatureStage = "scout" | "architect" | "plan" | "approval" | "execution" | "verification" | "complete";
export type FeatureStatus = "active" | "awaiting_approval" | "blocked" | "failed" | "completed" | "cancelled";
export type FeatureArtifact = "scout" | "architect" | "plan";
export type FeatureStepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface FeatureStep {
  id: string;
  title: string;
  description: string;
  status: FeatureStepStatus;
  verification?: string[];
  result?: string;
}

export interface FeatureWorkflow {
  schemaVersion: typeof FEATURE_STATE_VERSION;
  id: string;
  title: string;
  request: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  stage: FeatureStage;
  status: FeatureStatus;
  architectModel: string;
  summary?: string;
  approval: "pending" | "approved" | "rejected";
  currentStepIndex?: number;
  steps: FeatureStep[];
  artifacts: Partial<Record<FeatureArtifact, string>>;
  lastError?: string;
}

export class FeatureStoreError extends Error {
  readonly code: "not_found" | "invalid_id" | "invalid_state" | "locked" | "stale_revision" | "unsupported_version";

  constructor(
    message: string,
    code: "not_found" | "invalid_id" | "invalid_state" | "locked" | "stale_revision" | "unsupported_version",
  ) {
    super(message);
    this.name = "FeatureStoreError";
    this.code = code;
  }
}

interface LockRecord {
  pid: number;
  host: string;
}

const FEATURE_ROOT = join("plans", "features");
const ARTIFACT_FILES: Record<FeatureArtifact, string> = {
  scout: "scout.md",
  architect: "architect.md",
  plan: "plan.json",
};
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,100}$/i;
const STALE_LOCK_MS = 60_000;

export function createFeatureId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "feature";
  return `${slug}-${randomUUID().slice(0, 8)}`;
}

function getFeatureDir(cwd: string, id: string): string {
  if (!FEATURE_ID_PATTERN.test(id)) {
    throw new FeatureStoreError(`Invalid feature ID: ${id}`, "invalid_id");
  }
  return join(cwd, FEATURE_ROOT, id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateWorkflow(value: unknown, id?: string): FeatureWorkflow {
  if (!isRecord(value) || value.schemaVersion !== FEATURE_STATE_VERSION) {
    const code = isRecord(value) && typeof value.schemaVersion === "number"
      ? "unsupported_version"
      : "invalid_state";
    throw new FeatureStoreError("Feature state is malformed or uses an unsupported schema version", code);
  }

  const validStages: FeatureStage[] = ["scout", "architect", "plan", "approval", "execution", "verification", "complete"];
  const validStatuses: FeatureStatus[] = ["active", "awaiting_approval", "blocked", "failed", "completed", "cancelled"];
  const validStepStatuses: FeatureStepStatus[] = ["pending", "running", "passed", "failed", "skipped"];
  const workflow = value as unknown as FeatureWorkflow;
  const validSteps = Array.isArray(workflow.steps) && workflow.steps.every((step) =>
    isRecord(step) &&
    typeof step.id === "string" &&
    typeof step.title === "string" &&
    typeof step.description === "string" &&
    validStepStatuses.includes(step.status as FeatureStepStatus)
  );

  if (
    typeof workflow.id !== "string" ||
    (id !== undefined && workflow.id !== id) ||
    typeof workflow.title !== "string" ||
    typeof workflow.request !== "string" ||
    typeof workflow.createdAt !== "string" ||
    typeof workflow.updatedAt !== "string" ||
    !Number.isInteger(workflow.revision) ||
    workflow.revision < 0 ||
    !validStages.includes(workflow.stage) ||
    !validStatuses.includes(workflow.status) ||
    typeof workflow.architectModel !== "string" ||
    !["pending", "approved", "rejected"].includes(workflow.approval) ||
    !validSteps ||
    (workflow.currentStepIndex !== undefined &&
      (!Number.isInteger(workflow.currentStepIndex) || workflow.currentStepIndex < 0 || workflow.currentStepIndex > workflow.steps.length)) ||
    !isRecord(workflow.artifacts)
  ) {
    throw new FeatureStoreError("Feature state failed validation", "invalid_state");
  }

  return workflow;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname() } satisfies LockRecord));
    } finally {
      await handle.close();
    }
    return () => rm(lockPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  try {
    const [lockStat, lockContent] = await Promise.all([
      stat(lockPath),
      readFile(lockPath, "utf8").catch(() => ""),
    ]);
    let lock: LockRecord | undefined;
    try {
      const parsed: unknown = JSON.parse(lockContent);
      if (isRecord(parsed) && typeof parsed.pid === "number" && typeof parsed.host === "string") {
        lock = parsed as LockRecord;
      }
    } catch {
      // An incomplete lock can be left if the process crashed while creating it.
    }

    const isStale = Date.now() - lockStat.mtimeMs > STALE_LOCK_MS &&
      (!lock || (lock.host === hostname() && !isProcessAlive(lock.pid)));
    if (isStale) {
      await rm(lockPath, { force: true });
      return acquireLock(lockPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  throw new FeatureStoreError("Feature is being updated by another session; retry shortly", "locked");
}

async function withFeatureLock<T>(cwd: string, id: string, action: () => Promise<T>): Promise<T> {
  const lockPath = join(getFeatureDir(cwd, id), ".workflow.lock");
  const release = await acquireLock(lockPath);
  try {
    return await action();
  } finally {
    await release();
  }
}

export async function createFeatureWorkflow(
  cwd: string,
  input: Pick<FeatureWorkflow, "title" | "request" | "architectModel">,
): Promise<FeatureWorkflow> {
  const id = createFeatureId(input.title);
  const dir = getFeatureDir(cwd, id);
  await mkdir(join(cwd, FEATURE_ROOT), { recursive: true });
  await mkdir(dir);

  const now = new Date().toISOString();
  const workflow: FeatureWorkflow = {
    schemaVersion: FEATURE_STATE_VERSION,
    id,
    title: input.title,
    request: input.request,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    stage: "scout",
    status: "active",
    architectModel: input.architectModel,
    approval: "pending",
    currentStepIndex: 0,
    steps: [],
    artifacts: {},
  };

  try {
    await atomicWrite(join(dir, "workflow.json"), `${JSON.stringify(workflow, null, 2)}\n`);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return workflow;
}

export async function readFeatureWorkflow(cwd: string, id: string): Promise<FeatureWorkflow> {
  const statePath = join(getFeatureDir(cwd, id), "workflow.json");
  let content: string;
  try {
    content = await readFile(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FeatureStoreError(`Feature workflow not found: ${id}`, "not_found");
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new FeatureStoreError(`Feature workflow JSON is corrupt: ${id}`, "invalid_state");
  }
  return validateWorkflow(parsed, id);
}

export async function listFeatureWorkflows(cwd: string): Promise<{
  workflows: FeatureWorkflow[];
  errors: Array<{ id: string; message: string }>;
}> {
  let entries;
  try {
    entries = await readdir(join(cwd, FEATURE_ROOT), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { workflows: [], errors: [] };
    throw error;
  }

  const workflows: FeatureWorkflow[] = [];
  const errors: Array<{ id: string; message: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !FEATURE_ID_PATTERN.test(entry.name)) continue;
    try {
      workflows.push(await readFeatureWorkflow(cwd, entry.name));
    } catch (error) {
      errors.push({ id: entry.name, message: error instanceof Error ? error.message : String(error) });
    }
  }

  workflows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { workflows, errors };
}

export async function updateFeatureWorkflow(
  cwd: string,
  id: string,
  expectedRevision: number,
  update: (current: FeatureWorkflow) => FeatureWorkflow,
): Promise<FeatureWorkflow> {
  return withFeatureLock(cwd, id, async () => {
    const current = await readFeatureWorkflow(cwd, id);
    if (current.revision !== expectedRevision) {
      throw new FeatureStoreError(
        `Feature changed since it was read (expected revision ${expectedRevision}, found ${current.revision})`,
        "stale_revision",
      );
    }

    const next = validateWorkflow(update(current), id);
    const saved: FeatureWorkflow = {
      ...next,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await atomicWrite(join(getFeatureDir(cwd, id), "workflow.json"), `${JSON.stringify(saved, null, 2)}\n`);
    return saved;
  });
}

export async function writeFeatureArtifact(
  cwd: string,
  id: string,
  artifact: FeatureArtifact,
  content: string,
): Promise<string> {
  return withFeatureLock(cwd, id, async () => {
    await readFeatureWorkflow(cwd, id);
    const fileName = ARTIFACT_FILES[artifact];
    await atomicWrite(join(getFeatureDir(cwd, id), fileName), content);
    return join(FEATURE_ROOT, id, fileName);
  });
}

export async function readFeatureArtifact(
  cwd: string,
  id: string,
  artifact: FeatureArtifact,
): Promise<string> {
  try {
    return await readFile(join(getFeatureDir(cwd, id), ARTIFACT_FILES[artifact]), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FeatureStoreError(`Feature artifact not found: ${id}/${artifact}`, "not_found");
    }
    throw error;
  }
}
