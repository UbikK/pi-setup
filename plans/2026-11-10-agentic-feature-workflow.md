## Proposed Plan: Agentic feature-planning workflow

**Date**: 2026-11-10  
**Status**: approved / in-progress

**Goal**: Provide durable, resumable feature workflows with automated scouting, architect review using a stronger model, plan generation, and human-gated execution.

**Approved requirements**:
- Workflows must resume from new Pi sessions and support multiple features of different sizes.
- Architect must use a stronger model than the default planning model.
- No autonomous code edits in v1. Planning agents stay read-only; user approves the plan before existing stepwise execution begins.

**Implementation direction**:
- Store each feature independently under `plans/features/<feature-id>/` in the project, not in session-only `appendEntry` state. Keep `workflow.json` versioned; store scout, architect, and variable-length plan outputs as separate artifacts.
- Add commands to create, list, inspect/resume, and cancel a feature workflow; resume by feature ID from any new session in the same project.
- Architect model: `gaio/azure/gpt-6.1-terra`, available in current configured model catalog. Run at `high` thinking. Pass it only to architect delegation; do not change main-session or other agents' models. If that model cannot be resolved/authenticated, report a blocking error instead of silently falling back.
- Keep generated plan step count data-driven. For unusually large features, let the planner split work into reviewable stages; do not impose a fixed step count.

### Task 1: Confirm requirements and implementation direction
- **Goal**: Establish persistence, approval, variable-size plan, and architect model requirements before code changes.
- **Files affected**: `plans/2026-11-10-agentic-feature-workflow.md`
- **Change size**: Tiny
- **Status**: done
- **Depends on**: none
- **Acceptance criteria**:
  - Cross-session resume is required.
  - Architect uses `gaio/azure/gpt-6.1-terra` with high thinking and no silent fallback.
  - V1 pauses for plan approval before code execution.
  - Feature artifacts are project-local and independently addressable.
- **Risks / watch items**:
  - User-created in-progress changes must be preserved.
- **Notes**: User confirmed resume across new sessions, variable feature sizes, and stronger architect model. Model is listed by `pi --list-models 'gaio/azure/gpt-6.1-terra'`.

### Task 2: Add durable per-feature state and artifact storage
- **Goal**: Persist workflow progress independently of a Pi conversation so each feature can be resumed in a later session.
- **Files affected**: New feature-workflow storage/types module; new `plans/features/<feature-id>/` artifacts at runtime.
- **Change size**: Medium
- **Status**: done
- **Depends on**: Task 1
- **Acceptance criteria**:
  - Each run gets a stable unique feature ID and stores schema version, lifecycle stage, timestamps, approvals, errors, artifact references, selected architect model, and a variable-length step list.
  - Writes are validated and atomic; corrupt/unsupported state fails with a recoverable diagnostic.
  - Store APIs can enumerate and load workflows by ID from any session without relying on session entries or scratch files.
  - Multiple feature records do not overwrite each other.
- **Risks / watch items**:
  - Repository-local artifacts are visible and likely version-controlled; keep prompts/reports free of secrets and allow explicit cancellation/archive.
  - Concurrent sessions editing the same feature need stale-state protection.
- **Notes**: Added `extensions/lib/feature-store.ts` with versioned records, per-feature paths, atomic writes, lock/revision checks, variable-length steps, and artifact read/write. Runtime smoke test passed create/list/artifact round-trip with 27 steps and stale-revision rejection; IDE diagnostics clean. User-facing list/resume commands remain in Task 4.
### Task 3: Configure architect model selection
- **Goal**: Run architect delegations on configured stronger model while keeping other agents' defaults unchanged.
- **Files affected**: `agents/architect.md`, `extensions/lib/agents-lib.ts`, `extensions/coordinator.ts`.
- **Change size**: Small
- **Status**: done
- **Depends on**: Task 1
- **Acceptance criteria**:
  - Agent definitions can declare model and thinking level.
  - Coordinator passes `--model gaio/azure/gpt-6.1-terra --thinking high` for architect only.
  - Missing model/auth returns a clear failure; no silent weaker-model fallback.
  - Delegation record identifies model used.
- **Risks / watch items**:
  - Preserve existing named-agent tool restrictions and do not allow a project agent to select arbitrary write-capable tools unintentionally.
- **Notes**: Added `model` and `thinkingLevel` frontmatter support; architect configured for `gaio/azure/gpt-6.1-terra` at high. Coordinator validates model/auth, passes CLI overrides, records model/thinking, and surfaces failures. `pi --no-extensions --list-models 'gaio/azure/gpt-6.1-terra'` confirms child process can resolve model. IDE diagnostics clean. Full delegation run remains part of Task 5.
### Task 4: Orchestrate scout → architect → plan with resume and approval gates
- **Goal**: Run the read-only stages in sequence, pass reports explicitly, and resume at failed or pending stages.
- **Files affected**: `extensions/coordinator.ts` or a focused workflow extension; `extensions/plan.ts` only where shared plan execution state must be reconciled.
- **Change size**: Medium
- **Status**: done
- **Depends on**: Task 2, Task 3
- **Acceptance criteria**:
  - One feature command starts scout, architect validation, and plan generation; architect blockers route to bounded plan revision or stop.
  - User explicitly approves plan before any code change.
  - List/inspect/resume/cancel commands work from a fresh Pi session in the same project.
  - Stage outputs are persisted as artifacts; failures/timeouts leave a resumable state.
  - Architect and planner receive prior stage outputs directly, not through manual `/continue`.
- **Risks / watch items**:
  - Avoid duplicating `/scout`, `/plan`, `/delegate`, and `/plan-next` behavior.
  - Preserve existing session entries and command compatibility.
- **Notes**: Added `extensions/feature-workflow.ts` commands for start/list/show/resume/approve/reject/cancel. Workflow runs read-only scout and plan agents, architect review with recorded model and high thinking, one bounded plan revision, and persists stage artifacts. Approval populates existing `/plan-next` state; `plan.ts` records feature step state and supports project-local resume. Operator guide at `docs/feature-workflows.md`. Diagnostics clean; full interaction failure matrix remains in Task 5.

### Task 5: Verify, document, and exercise variable-size workflows
- **Goal**: Prove creation, review, approval, resume, and failure paths work and document operator controls.
- **Files affected**: Relevant extension tests or minimal test harness; `AGENTS.md` or focused workflow docs.
- **Change size**: Small / Medium, based on available test infrastructure
- **Status**: done
- **Depends on**: Task 4
- **Acceptance criteria**:
  - Exercise small and large plans with dynamically sized step arrays.
  - Test architect approval/rejection, malformed output, missing model/auth, agent failure/timeout, user rejection, corrupt state, stale state, and new-session resume.
  - Run available type/lint/test checks and report exact commands/results.
  - Document feature commands, state location, model used, approval gates, and archive/cancel behavior.
- **Risks / watch items**:
  - No root test configuration was found during scout; inspect extension test options before adding dependencies.
- **Notes**: Documented operator controls at `docs/feature-workflows.md`. `node --experimental-strip-types --input-type=module` smoke tests passed for 1- and 27-step records, artifact round-trip, stale revision rejection, and corrupt-state reporting. A temporary mocked-extension harness passed approval gate, bounded revision, architect approve/block/malformed verdict, planner malformed output, agent failure/timeout, missing model/auth, explicit rejection/cancel confirmation, `/plan-next` completion, and interrupted-feature resume. These used deterministic mocked subagent/model-registry responses; no live model delegation was run. `git diff --check` passed and VS Code diagnostics returned no errors. No root test runner exists, so no dependency or permanent harness was added.

- Existing `/scout` and `/plan` commands invoke read-only subagents; `/plan-next` confirms one step, but its `currentIndex` advances before dispatch.
- `/delegate` supports named agents and stores output under `.pi/scratch`; `/continue` is a manual transcript handoff. `agents/architect.md` is read-only but has no machine-readable verdict or model metadata yet.
- Plan state uses `pi.appendEntry()` and is session-file scoped. Pi docs confirm custom entries survive session restarts, but a separate new session will not see the prior session's plan state. Cross-session feature discovery needs project-local artifacts.
- Pi CLI supports `--model` and `--thinking`; `pi --list-models 'gaio/azure/gpt-6.1-terra'` confirms selected model is available in this environment.
- Working tree has concurrent uncommitted changes to `AGENTS.md`, coordinator/plan/scout extensions, agent definitions, settings/model files, and terminal-spawn. Preserve these; avoid replacing whole files.
- OpenSpec is not initialized. No root test configuration was found.

## Remaining decisions

- None block v1. Plan artifacts will live under `plans/features/` and be project-local. Revisit collaboration or concurrent-write needs if usage shows multiple sessions editing the same feature simultaneously.
