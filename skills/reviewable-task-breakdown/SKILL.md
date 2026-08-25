---
name: reviewable-task-breakdown
description: Breaks down a coding task into small, human-reviewable steps and pauses for approval before executing each one. Use when the user asks to implement, refactor, or fix something non-trivial and wants to review progress incrementally.
---

# Reviewable Task Breakdown

## Purpose

Turn a large or risky coding request into a sequence of small, reviewable steps. Each step should produce a coherent change that a human can understand, verify, and approve before the next step runs.

This skill helps avoid large surprise diffs, premature optimization, and decisions that are hard to undo.

## When to Use

Load this skill automatically when:

- The user asks you to "break this down," "do this step by step," or "let me review each part."
- You estimate the change will touch more than one file or module, or has ambiguous edges.
- The request touches architecture, public APIs, security, data models, or deployment.
- The user corrects or rejects an approach you took.

Skip the detailed breakdown for:

- One-line fixes inside a single file.
- Purely informational questions.
- Tasks where the user explicitly says "just do it."

## How to Use

The user can invoke it directly:

```text
/skill:reviewable-task-breakdown
```

Or simply ask things like:

- "Can you break this into small reviewable tasks?"
- "Let's plan the refactor before we start."
- "I want to review each step."

## Breakdown Protocol

### 1. Gather Context (if missing)

Before writing any plan:

1. Read `PROJECT_CONTEXT.md` or equivalent if it exists.
2. Check the current codebase for relevant files, tests, and conventions.
3. Ask the user any clarifying questions needed to scope the work.

Do not start planning until ambiguity is low enough to produce a useful plan. It is fine to say "I see two possible approaches; here are the trade-offs."

### 2. Write the Plan

Produce a written plan in this format:

```markdown
## Proposed Plan: <short title>

### Task 1: <verb + noun>
- **Goal**: One-sentence outcome.
- **Files affected**: Paths you expect to touch.
- **Change size**: Tiny / small / medium (no task should be "large").
- **Acceptance criteria**: Concrete, testable signals.
- **Risks / watch items**: What could go wrong or need rethinking.

### Task 2: ...
```

Rules for each task:

- **Title** is a verb phrase: e.g., "Add validation schema," "Extract payment helper," "Update tests."
- **Goal** is one sentence and explains the *outcome*, not the steps.
- **Size** is small enough to review in under 5 minutes.
- **Acceptance criteria** must be verifiable by the user without reading your full reasoning.
- **Risks** flag security, breaking changes, data loss, unclear requirements, or yak-shaving.
- **Depends on** is optional. Use it only when a task genuinely cannot be implemented without an earlier task's output.

### 3. Save the Plan to a Markdown File

Write the plan into a dedicated documentation folder so it can be reviewed, edited, and tracked like any other project artifact.

Default location:

```text
docs/plans/
```

If the project has no `docs/` folder, use:

```text
plans/
```

Filename convention:

```text
YYYY-MM-DD-short-kebab-title.md
```

Example: `docs/plans/2026-08-04-refactor-auth-middleware.md`

The file must include:

- A short title and date.
- The task list.
- A status for each task: `pending`, `in-progress`, `done`, or `skipped`.
- Space for notes after each task.

If the user has not approved the plan yet, write it as a draft, tell the user the file path, and wait for approval before updating statuses.

### 4. Get Approval

Present the plan and ask one of these questions:

- "Does this order look right? Any task to split, merge, or drop?"
- "Should I start with Task 1?"

Do not implement any task until the user confirms. If the user only approves part of the plan, limit execution to that part and update the plan file accordingly.

### 5. Execute One Task at a Time

For each approved task:

1. Update its status to `in-progress` in the plan file.
2. Tell the user which task you are starting.
3. Implement only what that task says.
4. Run relevant tooling if applicable (tests, lint, typecheck). If tooling isn't available, note that.
5. Update the plan file: mark the task `done` (or `skipped`) and append brief notes about what changed, decisions made, and any blockers.
6. Present a concise summary to the user: files changed, key decisions, test results, and any unexpected findings.
7. Wait for explicit user approval before starting the next task.

### 6. Replan When Needed

If during a task you discover that the remaining plan is wrong, stop and propose a revised plan before continuing. Don't silently deviate. Update the plan file to reflect the revised plan.

Situations that require replanning:

- A file or API you expected to use doesn't exist.
- A task becomes much larger than estimated.
- The user changes scope mid-stream.
- Tests reveal a design problem that affects later tasks.

## Plan Template

Use this exact structure for consistency:

```markdown
## Proposed Plan: <title>

**Date**: YYYY-MM-DD  
**Status**: draft | approved | in-progress | completed

### Task 1: <verb phrase>
- **Goal**: <outcome>
- **Files affected**: <list>
- **Change size**: Tiny / Small / Medium
- **Status**: pending / in-progress / done / skipped
- **Depends on**: <task id, e.g. `Task 1`, or `none`>
- **Acceptance criteria**:
  - <criterion 1>
  - <criterion 2>
- **Risks / watch items**:
  - <risk 1>
- **Notes**: <what happened; leave empty in draft>

### Task 2: ...
```

## Anti-Patterns to Avoid

- ❌ Tasks that say "do everything else" or "misc cleanup."
- ❌ Tasks with no acceptance criteria.
- ❌ Implementing multiple tasks without pausing.
- ❌ Hiding a big architectural decision inside a small task.
- ❌ Treating "the user didn't object" as approval.
- ❌ Building a full plan and then ignoring it when execution gets messy.

## Example

User: "Refactor the auth middleware."

You respond with a draft plan and write it to `docs/plans/2026-08-04-refactor-auth-middleware.md`:

```markdown
## Proposed Plan: Refactor auth middleware

**Date**: 2026-08-04  
**Status**: draft

### Task 1: Identify current middleware call sites and tests
- **Goal**: Map every route and unit test that depends on the current middleware.
- **Files affected**: `src/middleware/auth.ts`, test files, route files.
- **Change size**: Tiny
- **Status**: pending
- **Acceptance criteria**:
  - List of call sites is complete.
  - No code changes yet; only notes.
- **Risks / watch items**:
  - Hidden dynamic imports or framework-level middleware registration.
- **Notes**:

### Task 2: Extract token verification into a pure helper
- **Goal**: Move JWT verification logic out of the middleware so it can be unit tested.
- **Files affected**: `src/auth/verify-token.ts` (new), `src/middleware/auth.ts`.
- **Change size**: Small
- **Status**: pending
- **Depends on**: none
- **Acceptance criteria**:
  - `verifyToken` has a standalone test.
  - Existing integration tests still pass.
- **Risks / watch items**:
  - Existing error messages must remain unchanged for callers.
- **Notes**:

### Task 3: Update middleware to use the helper and add error mapping
- **Goal**: Simplify the middleware and standardize error responses.
- **Files affected**: `src/middleware/auth.ts`, `src/auth/errors.ts`.
- **Change size**: Small
- **Status**: pending
- **Depends on**: Task 2
- **Acceptance criteria**:
  - Middleware uses the new helper.
  - Responses match the documented shape.
  - All tests pass.
- **Risks / watch items**:
  - Changing response shape may break clients.
- **Notes**:
```

Then wait for the user to approve.
