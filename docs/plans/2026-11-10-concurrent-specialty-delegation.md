## Proposed Plan: Concurrent specialty-based feature execution

**Date**: 2026-11-10  
**Status**: in-progress

### Task 1: Prepare frontend and backend implementers
- **Goal**: Provide distinct frontend and senior backend agents that can edit code only within explicitly delegated task scope.
- **Files affected**: `agents/frontend-engineer.md`, `agents/backend-engineer.md` (new)
- **Change size**: Small
- **Status**: done
- **Depends on**: none
- **Acceptance criteria**:
  - Frontend agent retains its domain expertise and can implement scoped changes with `edit`/`write` tools.
  - Backend agent is explicitly senior-level and has matching scoped code-writing tools.
  - Neither receives shell access by default.
- **Risks / watch items**:
  - Existing frontend profile says read-only despite already listing write tools; preserve review-only behavior unless implementation is explicitly requested.
- **Notes**: Updated frontend-engineer as code-writing reviewer/implementer with `APPROVED FEATURE STEP` gating; added senior backend-engineer with same scoped edit/write tool allowlist. Both lack shell access. VS Code diagnostics clean; `git diff --check` passed.

### Task 2: Put executor and project assignments in approved plan data
- **Goal**: Make each step's specialist and target project visible before the user approves the overall plan.
- **Files affected**: `extensions/feature-workflow.ts`, `extensions/lib/feature-store.ts`, `extensions/plan.ts`
- **Change size**: Medium
- **Status**: done
- **Depends on**: Task 1
- **Acceptance criteria**:
  - Plan output identifies frontend/backend/main execution role, target project path, and any execution dependencies.
  - Architect review and user approval display assignments.
  - Existing workflows without assignments remain readable and default safely to main-session execution.
- **Risks / watch items**:
  - Add optional fields compatibly; avoid invalidating existing schema-v1 records.
- **Notes**: Added optional agent, absolute projectPath, targetPaths, and earlier-step dependsOn metadata to schema-v1 step records and session plan state. Planner prompt requests assignments; paths are checked/normalized, named specialists must expose edit/write, target paths cannot escape project roots, and dependencies must point backward. Architect review and approval dialog show assignments. Older plans without metadata default to main/current project. Mocked orchestration test passed specialist/project/dependency persistence, approval visibility, legacy defaults, and invalid dependency rejection; legacy store smoke test passed. VS Code diagnostics clean; `git diff --check` passed.

### Task 3: Dispatch approved steps concurrently in separate terminals
- **Goal**: Launch one individually confirmed step at a time while allowing its agent to run concurrently with other separately approved steps.
- **Files affected**: `extensions/plan.ts`, `extensions/terminal-spawn/index.ts`, `extensions/terminal-spawn/types.ts`, `extensions/lib/feature-store.ts`
- **Change size**: Medium
- **Status**: pending
- **Depends on**: Task 2
- **Acceptance criteria**:
  - Confirmation names specialist, project path, and target scope before launch.
  - Each code-writing agent gets an independent terminal pane and requested project working directory.
  - Launch returns control without waiting for completion; no step starts without its own confirmation.
  - No silent headless fallback for code-writing dispatch when separate terminal is required.
  - Same-codebase parallel execution is limited to plan steps marked independent; other workflows/projects can run concurrently.
- **Risks / watch items**:
  - Agents share files within the same working tree; declared target overlap and unexpected edits can conflict.
  - cmux/Ghostty are current visible-terminal backends; unsupported terminal environments must fail clearly.

### Task 4: Persist concurrent run state and recovery
- **Goal**: Track multiple active step runs independently and avoid duplicate dispatch after resume or concurrent updates.
- **Files affected**: `extensions/lib/feature-store.ts`, `extensions/feature-workflow.ts`, `extensions/plan.ts`
- **Change size**: Medium
- **Status**: pending
- **Depends on**: Task 3
- **Acceptance criteria**:
  - Every run has unique identity, agent, project, and step status; completion/failure updates do not overwrite another concurrent step.
  - Resume identifies active runs and does not duplicate them; interrupted/failed work is explicitly retryable.
  - Concurrent revision conflicts are handled safely or surfaced without losing updates.
- **Risks / watch items**:
  - Extension process restart can outlive or orphan visible terminal work; define detectable active-run ownership and recovery behavior.

### Task 5: Test and document approved concurrent delegation
- **Goal**: Verify approval, specialist selection, separate project cwd, concurrent completion/failure, resume, and legacy behavior.
- **Files affected**: focused workflow documentation and available extension test harness
- **Change size**: Small / Medium, based on test infrastructure
- **Status**: pending
- **Depends on**: Task 4
- **Acceptance criteria**:
  - Test each step requires its own confirmation and non-feature `/plan-next` remains unchanged.
  - Exercise same-project independent work, separate project paths, two terminal runs, failure/retry, and session resume.
  - Run available diagnostics and checks; report exact commands/results.
  - Document visible-terminal requirement and shared-working-tree conflict limits.
- **Risks / watch items**:
  - No root test runner is configured; avoid adding a dependency without need.
- **Notes**:

## Scout discoveries

- `extensions/plan.ts` currently waits for each `runSubagent` dispatch indirectly by sending execution back to the main session; it cannot launch independent specialists concurrently today.
- `extensions/terminal-spawn/index.ts` creates a separate cmux/Ghostty pane for each run, but waits for completion and falls back to headless mode. `SpawnOptions` already supports per-run `cwd`, output file, and label.
- Feature step state is project-local; updates are revision-checked and locks serialize individual writes. Concurrent step completion therefore needs per-step identities and safe state mutation.
- Existing `agents/frontend-engineer.md` is technically allowed `edit` and `write` tools but its system prompt explicitly says it is read-only. Existing implementation must reconcile that contradiction.
- Existing feature planner does not record agent, project, or parallel-safety metadata; approval currently shows only step title and description.
- The first planning subagent and follow-up concurrency scout timed out. This plan is synthesized from the completed initial scout report and direct file inspection.

## Open design constraint

- Same-project concurrency uses a shared working tree, not isolated Git worktrees. Only explicitly independent/disjoint steps should launch together; tool allowlists do not enforce file-path boundaries. Separate project paths are shown and confirmed per step.
