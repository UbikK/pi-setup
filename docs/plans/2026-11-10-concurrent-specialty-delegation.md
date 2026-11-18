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
- **Files affected**: `extensions/plan.ts`, `extensions/feature-workflow.ts`, `extensions/terminal-spawn/index.ts`, `extensions/terminal-spawn/types.ts`, `extensions/lib/feature-store.ts`
- **Change size**: Medium
- **Status**: done
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
- **Notes**: `/plan-next` now confirms and dispatches exactly one approved step, then returns while specialist runs in the background. Preflight checks agent tools/model/auth and visible-terminal availability. Child gets `--no-session --no-extensions`, exact tool allowlist, approved-step marker, target project cwd, and a separate cmux/Ghostty pane; headless fallback is refused. Independent same-project steps can overlap only with declared, non-overlapping target paths; dependencies gate launch. Per-step run IDs, revision-retrying state updates, and result messages are in place; owner detection/recovery remains Task 4. Mocked terminal/agent harnesses passed disjoint same-project concurrency, overlapping-scope rejection, dependency gating, separate project cwd/panes, no-headless behavior, per-step confirmations, and non-triggering completion messages. VS Code diagnostics clean; `git diff --check` passed.
- **Goal**: Track multiple active step runs independently and avoid duplicate dispatch after resume or concurrent updates.
- **Files affected**: `extensions/lib/feature-store.ts`, `extensions/feature-workflow.ts`, `extensions/plan.ts`, `extensions/terminal-spawn/index.ts`, `extensions/terminal-spawn/types.ts`, `extensions/terminal-spawn/shared.ts`
- **Change size**: Medium
- **Status**: done
- **Depends on**: Task 3
- **Acceptance criteria**:
  - Every run has unique identity, agent, project, and step status; completion/failure updates do not overwrite another concurrent step.
  - Resume identifies active runs and does not duplicate them; interrupted/failed work is explicitly retryable.
  - Concurrent revision conflicts are handled safely or surfaced without losing updates.
- **Risks / watch items**:
  - Extension process restart can outlive or orphan visible terminal work; define detectable active-run ownership and recovery behavior.
- **Notes**: Added per-run IDs, worker PID/host/backend/pane, project output/meta paths, and start time. Wrapper publishes child PID; `runSubagent` persists ownership, requires visible terminals for code steps, and sends SIGTERM on timeout. Resume leaves live local workers running, recovers completed meta/output, marks dead local workers retryable, and asks before retrying unverifiable/remote work. Feature cancel is blocked while any worker may still be editing. Latest-revision updates and run-ID guards prevent concurrent completions from overwriting each other. Mocked recovery and real local child-process/terminal harnesses passed active resume, no duplicate dispatch, dead/unknown recovery, timeout termination, and concurrent completion. `git diff --check` passed; VS Code diagnostics are clean across workflow, store, plan, and terminal-spawn files.

### Task 5: Test and document approved concurrent delegation
- **Goal**: Verify approval, specialist selection, separate project cwd, concurrent completion/failure, resume, and legacy behavior.
- **Files affected**: focused workflow documentation and available extension test harness
- **Change size**: Small / Medium, based on test infrastructure
- **Status**: done
- **Depends on**: Task 4
- **Acceptance criteria**:
  - Test each step requires its own confirmation and non-feature `/plan-next` remains unchanged.
  - Exercise same-project independent work, separate project paths, two terminal runs, failure/retry, and session resume.
  - Run available diagnostics and checks; report exact commands/results.
  - Document visible-terminal requirement and shared-working-tree conflict limits.
- **Risks / watch items**:
  - No root test configuration was found during scout; avoid adding a dependency without need.
- **Notes**: Updated `docs/feature-workflows.md` with assignments, independent-step rules, separate project panes, visible-terminal requirement, resume/retry, cancellation limits, and shared-working-tree risk. No root `package.json`, `tsconfig`, or test runner exists, so no dependency/test framework was added. Ad hoc `node --experimental-strip-types --input-type=module` harnesses passed: plain `/plan-next` compatibility; per-step confirmations; two same-project disjoint agents; overlap/dependency blocking; distinct project working directories; failed-step inspection and explicitly approved retry; active/new-session resume without duplicate dispatch; worker timeout termination; and completion/failure recovery. Fake Pi output and mocked cmux API were used; actual local child processes exercised PID capture and terminal runner, with no code-writing model calls. `git diff --check` passed; VS Code diagnostics returned no errors for changed TypeScript files.

## Scout discoveries

- `extensions/plan.ts` currently waits for each `runSubagent` dispatch indirectly by sending execution back to the main session; it cannot launch independent specialists concurrently today.
- `extensions/terminal-spawn/index.ts` creates a separate cmux/Ghostty pane for each run, but waits for completion and falls back to headless mode. `SpawnOptions` already supports per-run `cwd`, output file, and label.
- Feature step state is project-local; updates are revision-checked and locks serialize individual writes. Concurrent step completion therefore needs per-step identities and safe state mutation.
- Existing `agents/frontend-engineer.md` is technically allowed `edit` and `write` tools but its system prompt explicitly says it is read-only. Existing implementation must reconcile that contradiction.
- Existing feature planner does not record agent, project, or parallel-safety metadata; approval currently shows only step title and description.
- The first planning subagent and follow-up concurrency scout timed out. This plan is synthesized from the completed initial scout report and direct file inspection.

## Open design constraint

- Same-project concurrency uses a shared working tree, not isolated Git worktrees. Only explicitly independent/disjoint steps should launch together; tool allowlists do not enforce file-path boundaries. Separate project paths are shown and confirmed per step.
