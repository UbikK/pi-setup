import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  thinkingLevel?: AgentThinkingLevel;
  systemPrompt: string;
  filePath: string;
}

/** Tools used when an agent definition does not declare its own. */
export const DEFAULT_AGENT_TOOLS = ["read", "grep", "find", "ls"];

function normalizeTools(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const tools = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

function loadFromDir(dir: string): AgentDefinition[] {
  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: AgentDefinition[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
    if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
      continue;
    }

    const model = typeof frontmatter.model === "string" ? frontmatter.model.trim() : undefined;
    const thinkingLevel = ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      frontmatter.thinkingLevel as string,
    )
      ? frontmatter.thinkingLevel as AgentThinkingLevel
      : undefined;

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: normalizeTools(frontmatter.tools),
      model: model || undefined,
      thinkingLevel,
      systemPrompt: body,
      filePath,
    });
  }
  return agents;
}

/**
 * Discover agent definitions from the user agent directory and the optional
 * project directory. Project definitions win on name collisions so a repo can
 * override a personal agent.
 */
export function discoverAgents(cwd: string): AgentDefinition[] {
  const projectDir = path.join(cwd, ".pi", "agents");
  const byName = new Map<string, AgentDefinition>();

  for (const agent of loadFromDir(path.join(getAgentDir(), "agents"))) byName.set(agent.name, agent);
  for (const agent of loadFromDir(projectDir)) byName.set(agent.name, agent);

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findAgent(cwd: string, name: string): AgentDefinition | undefined {
  return discoverAgents(cwd).find((a) => a.name === name);
}
