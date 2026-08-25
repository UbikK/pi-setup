---
name: project-context
description: Defines how to capture, maintain, and use per-project context for agent interactions in an agent-agnostic way, supporting both solo and team workflows.
---

# Project Context

## Overview

Project context is a durable, human-editable record of project-specific facts and decisions. It helps an agent make consistent recommendations without re-deriving basics every session, and it acts as a lightweight contract between humans and the agent.

This skill is **agent-agnostic**: any agent that can read Markdown and YAML frontmatter can use it. It also adapts automatically between **solo** and **team** workflows based on the `team.size` field.

## File Location

Use **one** of these standard locations. Pick one and stay consistent.

| Priority | Path | Notes |
|----------|------|-------|
| 1 | `PROJECT_CONTEXT.md` at repo root | Recommended — visible and version-controllable |
| 2 | `.project-context.md` at repo root | Hidden but discoverable via convention |
| 3 | `docs/project-context.md` | If you prefer keeping metadata under `docs/` |
| 4 | `.agent/project-context.md` | For harness-specific conventions |

If an agent harness expects its own path (e.g. `.opencode/project-context.md`), symlink or copy from the primary location. Do not maintain two sources of truth.

## File Format

Markdown with YAML frontmatter for structured metadata and a Markdown body for narrative, decision log, and agent behavior defaults.

```markdown
---
name: my-project
description: One-sentence purpose of the project
mode: solo                  # solo | team; inferred from team.size if omitted
team:
  size: 1                   # 1 for solo, >1 for team
  owner: alice              # Required when size > 1; optional when solo
  maintainers: []           # Required when size > 1
  review_cadence: quarterly # monthly for teams, quarterly for solo
tech_stack:
  language: TypeScript
  runtime: Node.js 22
  frameworks: [Hono, React, Vite]
  package_manager: pnpm
  test_runner: Vitest
architecture: monorepo-spa-plus-api
quality_bar:
  tests: unit + integration, target 80% coverage
  ci: GitHub Actions, required status checks
  reviews: PR approval required
deploy:
  frequency: daily
  platform: Railway
  requires_approval: false
constraints:                # Non-obvious rules the agent must respect
  - Auth tokens in HTTP-only cookies only
  - No PII in logs
  - p99 < 200ms on hot paths
preferences:                # Agent behavior defaults
  sparring_intensity: deep
  style: strict TypeScript, flat ESLint config, feature folders
  avoid: [axios, Redux, localStorage for tokens]
  verbosity: terse
escalation:                 # Required when size > 1
  architecture: alice
  security: bob
  infra: charlie
last_reviewed: "2026-07-27"
review_interval_days: 90    # 30 recommended for teams, 90 for solo
---

## Active Decisions

Decisions that are still in effect and relevant to the agent.

- **2026-07-27 — Dependency version policy**: Treat package versions in skill snippets as examples; resolve latest stable unless compatibility requires pinning.

## Agent Behavior Defaults

- Default to deep sparring for architecture, dependencies, public APIs.
- Prefer explicit return types on public functions.
- Use feature-based folder structure.
- Do not add dependencies without checking `constraints` and `preferences.avoid`.
```

## Schema Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Project name |
| `description` | yes | One-sentence purpose |
| `mode` | recommended | `solo` or `team`; inferred from `team.size` if omitted |
| `team.size` | recommended | `1` for solo, `>1` for team |
| `team.owner` | when `size > 1` | Person accountable for keeping context current |
| `team.maintainers` | when `size > 1` | List of people who can update context |
| `team.review_cadence` | recommended | How often the team reviews context |
| `tech_stack` | recommended | Languages, runtimes, frameworks, package manager |
| `architecture` | recommended | e.g. monolith, microservices, monorepo, SPA+API |
| `quality_bar` | recommended | Testing, linting, coverage, review requirements |
| `deploy` | optional | Cadence, platform, approval gates |
| `constraints` | recommended | Security, compliance, performance, or policy rules |
| `preferences` | recommended | Style, intensity, verbosity, libraries to avoid |
| `escalation` | when `size > 1` | Who to route architecture/security/infra questions to |
| `last_reviewed` | yes | ISO date of last context review |
| `review_interval_days` | recommended | Days before context is considered stale |

## Solo vs Team Workflows

The agent infers the workflow from `team.size` (or `mode` if explicit).

| Rule | Solo (`size == 1` or omitted) | Team (`size > 1`) |
|------|-------------------------------|-------------------|
| Decision log | Inline under `## Active Decisions` | External ADRs under `docs/decisions/` |
| Log cap | Keep last 10–15 decisions or 3 months | No cap; ADRs carry their own status |
| Review interval | 90 days | 30 days |
| Ownership | Optional | Required (`team.owner`) |
| Updates | Self-policed | PR + one approval |
| Escalation | N/A | Required |
| Stale handling | Agent flags and offers refresh | Agent refuses major architecture advice until owner refreshes |

### Solo workflow

- Keep the file minimal.
- Inline decision log is fine, but cap it.
- Move long-lived decisions into `constraints` or `preferences` so they do not rot in the log.

### Team workflow

- Every significant decision becomes an ADR in `docs/decisions/`.
- Link active ADRs in the body; the agent follows the link.
- Deprecated or superseded ADRs stay in `docs/decisions/` but are marked `status: deprecated`.
- Changes to `PROJECT_CONTEXT.md` use the same PR process as code.

## Decision Records (team workflow)

Use a lightweight ADR format under `docs/decisions/000-title.md`:

```markdown
---
id: 003
title: Use Zustand over Redux
status: active
supersedes: []
date: "2026-06-15"
author: alice
---

## Context
Team was split between Redux Toolkit and Zustand for global state.

## Decision
Use Zustand for global client state. Redux only if we outgrow Zustand.

## Consequences
- Smaller bundle, less boilerplate
- Less ecosystem tooling; accept the trade-off
```

ADR status values: `proposed`, `accepted`, `deprecated`, `superseded`. The agent ignores `proposed` and `deprecated` ADRs.

## Lifecycle Protocol

1. **Discovery**: At the start of a deep session, the agent reads the primary context file.
2. **Missing context**: Ask the context questions, create the file, and save it.
3. **Stale check**: Compare `last_reviewed` to today. If older than `review_interval_days`, flag as stale and offer to refresh.
4. **Update triggers**:
   - New dependency, framework, or runtime
   - New public API, data model, or architecture boundary
   - New security/performance/compliance constraint
   - Change in deploy cadence or ownership
   - Any significant decision made during sparring
5. **Review**: During stale review, prune log entries and promote long-lived decisions to `constraints` or `preferences`.

## Migration: Solo → Team

When the project grows beyond one maintainer:

1. Update `team.size`, `team.owner`, and `team.maintainers`.
2. Set `mode: team` and `review_interval_days: 30`.
3. Add `escalation` paths.
4. Move inline decisions from the body to `docs/decisions/` as ADRs.
5. Require PR review for future context changes.

## Anti-Patterns

- ❌ Maintaining two context files in different formats.
- ❌ Letting the decision log grow without eviction or promotion.
- ❌ Storing secrets in the context file.
- ❌ Copying `package.json` contents verbatim into `tech_stack`.
- ❌ Treating the file as immutable once created.

## Relation to Other Skills

- `sparring-deep` loads this skill and uses project context before making architectural recommendations.
- `sparring-light` may skip context loading for localized changes, but escalates if the change touches constraints or active decisions.

## Example Agent Prompt Usage

```
Before making architecture or dependency recommendations, read PROJECT_CONTEXT.md.
If it is missing, ask the user the context questions and create it.
If last_reviewed is older than review_interval_days, flag it as stale.
Respect all constraints and preferences when proposing solutions.
```
