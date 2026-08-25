---
name: branch-per-task
description: Creates a feature branch for each actionable task in a coding plan, commits the task's changes to that branch, and leaves the branch ready for human review. Uses dependency-aware branching when the plan specifies dependencies. Use when the user wants work split into reviewable, commit-granular branches rather than one large diff.
---

# Branch per Task

## Purpose

Execute a coding plan one task at a time, with each task living in its own branch and its own commit. This keeps every change reviewable, bisectable, and easy to discard or merge independently.

## When to Use

Load this skill automatically when the user says things like:

- "Create a branch per task."
- "Commit each task to its own branch."
- "I want each step as a separate branch."
- "Execute this plan branch by branch."

This skill works best with an existing plan (e.g., from `reviewable-task-breakdown`). If there is no plan, create or ask for one first.

## Safety Rules

- **Never merge.** Only a human merges branches.
- **Never force-push.**
- **Never commit without explicit approval** for the staged diff.
- **Never push without explicit approval.**
- **Do not run destructive git commands** (`reset --hard`, `clean -fd`, etc.) unless the user explicitly confirms.

## Prerequisites

1. You are inside a git repository.
2. The working tree on the base branch is clean (no uncommitted changes).
3. You have/write a plan with clearly scoped tasks.

## How to Use

The user can invoke it directly:

```text
/skill:branch-per-task
```

Or in context:

- "For the auth refactor plan, create a branch for each task and commit the changes."
- "Execute this plan branch by branch."

## Workflow

### 1. Confirm the Plan

1. Read the relevant plan file (e.g., `docs/plans/YYYY-MM-DD-title.md`).
2. Confirm with the user which tasks to execute.
3. Confirm the base branch:
   - Default: `main`
   - Fallback: `master`
   - Otherwise ask the user.
4. Determine the branching strategy:
   - **Auto** (default): each task branches from the base branch unless the plan lists a `Depends on` task; if so, branch from that task's branch.
   - **Independent**: every task branches from the base branch, ignoring `Depends on`.
   - **Stacked**: each task branches from the previous task's branch.

### 1.5 Validate Dependencies

Build a dependency graph from the `Depends on` fields in the plan.

- A task may only depend on an earlier-numbered task.
- If a task depends on a later task, a nonexistent task, or an out-of-scope task, stop and ask the user to fix the plan before branching.
- In `auto` mode, record the parent branch for each dependent task.

### 2. For Each Task

#### 2.1 Prepare the Base

1. Determine the base branch for this task (see branch creation rules below).
2. `git fetch` (do not pull unless the user explicitly asks).
3. `git checkout <base-branch>`.
4. Check `git status`. If dirty, stop and ask the user to stash, commit, or clean up.

#### 2.2 Create the Branch

Branch naming convention:

```text
task/<plan-slug>-t<N>-<short-kebab-task-title>
```

Examples:

- `task/refactor-auth-middleware-t2-extract-verify-token`
- `task/api-rate-limit-t1-add-throttle-schema`

If the total name would exceed 80 characters, truncate the task-title part.

Determine the base branch:

- **Independent mode**: `<base-branch>` (e.g., `main`).
- **Stacked mode**: previous task's branch; for Task 1, use `<base-branch>`.
- **Auto mode**:
  - If the task has `Depends on: Task X` and Task X has a recorded branch, use that branch as the base.
  - Otherwise use `<base-branch>`.
  - If the dependency branch's tip has changed since the dependent branch was created, stop and ask before rebasing or recreating.

Create the branch:

```bash
git checkout -b task/<plan-slug>-t<N>-<short-title> <base>
```

Record the parent branch in the plan file notes for this task.

#### 2.3 Implement the Task

Make only the changes required by this task. If the task becomes larger than planned, stop and propose a revised plan or an additional task branch before continuing.

#### 2.4 Review Before Commit

1. `git status`
2. `git diff --stat`
3. Present a concise summary of what changed and the planned commit message.
4. Ask for explicit approval to commit.

#### 2.5 Commit

If approved, commit with a descriptive message following conventional commits:

```text
<type>(<scope>): <imperative summary>

<body: what changed and why>

Task: <N> of <plan-file-path>
```

Example:

```text
feat(auth): extract token verification into pure helper

- Add src/auth/verify-token.ts with verifyToken function
- Update src/middleware/auth.ts to use the new helper
- Preserve existing error message text for callers

Task: 2 of docs/plans/2026-08-04-refactor-auth-middleware.md
```

Commit command:

```bash
git add -A
git commit -m "feat(auth): extract token verification into pure helper" -m "- Add src/auth/verify-token.ts with verifyToken function" -m "- Update src/middleware/auth.ts to use the new helper" -m "- Preserve existing error message text for callers" -m "Task: 2 of docs/plans/2026-08-04-refactor-auth-middleware.md"
```

Update the plan file: mark the task as `done` and add notes including the branch name and commit hash.

#### 2.6 Push (optional, explicit approval required)

Ask the user:

- "Push `task/...` to origin?"

If approved:

```bash
git push -u origin task/...
```

If not approved, leave the branch local.

#### 2.7 Return to Base

```bash
git checkout <base-branch>
```

### 3. Final Summary

After all tasks are done, present:

- List of branches created.
- Commit hashes or `git log` snippets.
- Any tasks skipped, replanned, or blocked.
- Suggested next step: "You can now review/merge the branches in your preferred order."

## Plan File Updates

While executing the skill, keep the plan file in sync:

- When a task starts, mark it `in-progress`.
- When a task is committed, mark it `done` and record:
  - Branch name
  - Commit hash
  - Notes about deviations or decisions
- If replanning, update or create a new plan file version and explain the change.

## Anti-Patterns

- ❌ Putting multiple tasks on one branch.
- ❌ Committing without showing the diff first.
- ❌ Pushing without approval.
- ❌ Merging branches.
- ❌ Force-pushing.
- ❌ Using vague commit messages like `update` or `fix`.
- ❌ Continuing when the working tree is dirty.
- ❌ Branching from a dependency task branch that has not been committed yet.
- ❌ Ignoring `Depends on` in auto mode.
- ❌ Silently rebasing a dependent branch when its parent branch changes.

## Example

User: "Execute the auth refactor plan branch by branch."

You respond:

```markdown
Plan file: docs/plans/2026-08-04-refactor-auth-middleware.md
Base branch: main
Branching strategy: auto (Task 3 depends on Task 2)

I'll create these branches:

1. `task/refactor-auth-middleware-t1-map-call-sites`
2. `task/refactor-auth-middleware-t2-extract-verify-token`
3. `task/refactor-auth-middleware-t3-update-middleware`

I'll start with Task 1 and pause for your approval before each commit.
```

Then proceed one task at a time.
