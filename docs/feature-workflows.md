# Durable feature workflows

Feature workflows persist under `plans/features/<feature-id>/` in the current project. Each workflow has a versioned `workflow.json` plus separate `scout.md`, `plan.json`, and `architect.md` artifacts. Keep these files free of secrets. They are ordinary project files and may be version-controlled.

## Commands

- `/feature start <title> :: <request>` — create workflow; run scout, generate variable-length plan, and ask architect to review it.
- `/feature list` — list workflows and report unreadable state files.
- `/feature show <id>` — inspect state, plan, and saved reports.
- `/feature resume <id>` — retry a failed/blocked stage, or restore approved execution plan in a new Pi session.
- `/feature approve <id>` — review and explicitly approve plan. This queues plan in existing `/plan-next` workflow; approval does not itself edit code.
- `/feature reject <id>` — reject pending plan and retain artifacts.
- `/feature cancel <id>` — cancel workflow and retain artifacts.

Architect runs use model recorded at workflow creation (currently `gaio/azure/gpt-6.1-terra`) with configured high thinking. Missing model or auth blocks the workflow; there is no fallback. Architect may request one plan revision. A second revision request or a block verdict stops workflow for human inspection.

After approval, each `/plan-next` call asks for approval for one step and shows executor, project path, target paths, dependencies, and tool allowlist. Confirming launches only that step. Specialist work runs asynchronously in its own cmux/Ghostty pane, so you can approve another eligible step while earlier agents work. Completion reports are shown without starting another assistant turn.

Plans classify each step as `frontend-engineer`, `backend-engineer`, or `main`. They also include an existing project directory, relative target paths, and earlier-step dependencies. Main-session work is limited to the workflow project. Other projects require explicit paths in the request and named specialists. Steps with dependencies wait until prerequisites pass. Same-working-tree steps run concurrently only when declared target paths do not overlap; empty/unknown target scopes prevent overlapping project work. Separate project roots can run concurrently. Agents share the approved project's working tree; target paths guide scope but are not filesystem sandbox boundaries.

Code-writing agents require a visible cmux or Ghostty terminal. If neither is available, agent step will not start; no headless fallback. Children run with `--no-session --no-extensions` and their configured tool allowlist. Frontend/backend agents edit only when task includes `APPROVED FEATURE STEP`; neither gets shell access by default.

Use `/feature resume <id>` in another Pi session to reconcile run state. Live local workers remain marked running and are not redispatched. Completed worker output is recovered from metadata; exited workers become failed and can be retried only after another `/plan-next` confirmation. Unverifiable or remote worker ownership requires explicit confirmation before retry, since duplicate edits may result. Worker timeout sends SIGTERM. `/feature cancel` refuses while any step may still be editing; stop or wait for terminal workers, then resume and cancel.

Rejecting or cancelling a workflow keeps its artifacts. Archive or remove a feature directory under `plans/features/` manually after review.
