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

After approval, `/plan-next` asks before dispatching each step. To continue in another Pi session, run `/feature resume <id>` and then `/plan-next`. If a step was interrupted, resume replays that running step rather than silently skipping it. Invoking `/plan-next` for the next step records prior running step as passed; reaching end records workflow complete.

Cancellation/rejection do not delete artifacts. Archive or remove a workflow by moving/deleting its feature directory manually after review. Concurrent workflow updates use revision checks and locks; retry if another session is currently updating same feature.
