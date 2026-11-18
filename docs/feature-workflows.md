# Durable feature workflows in OpenCode

The global OpenCode `feature-workflow` plugin stores each feature under `plans/features/<feature-id>/` in the active project. Each workflow has versioned `workflow.json` plus `scout.md`, `plan.json`, and `architect.md`. Keep requests and reports free of secrets; these files may be version-controlled.

## Commands

- `/feature start <title> :: <request>` — run read-only Explore, generate a variable-length plan with built-in Plan, then request Architect review.
- `/feature list` — list workflows and report unreadable state files.
- `/feature show <id>` — inspect state, plan, and saved reports.
- `/feature resume <id>` — resume a failed planning stage or inspect an approved execution plan.
- `/feature approve <id>` — explicitly approve reviewed plan.
- `/feature reject <id>` — reject pending plan and retain artifacts.
- `/feature next <id>` — execute exactly one approved step in an OpenCode child session.
- `/feature cancel <id>` — cancel workflow and retain artifacts.

OpenCode's built-in Plan and Explore agents replace Pi's custom `/plan` and `/scout` commands. Architect runs as the read-only `architect` subagent with `gaio/gpt-6.1-terra#high`; a missing agent blocks the workflow. Architect may request one plan revision. A second revision request or a block verdict stops for human inspection.

Every implementation step requires a separate `/feature next <id>` command after plan approval. Specialist steps use the configured backend/frontend agents; `main` steps use OpenCode's build agent. Each step runs sequentially in a child session, and results update the durable workflow state. Interrupted or failed steps remain visible and can be retried with `/feature next <id>`. Visible cmux/Ghostty terminal panes and concurrent dispatch are not part of this OpenCode adaptation.

Rejection and cancellation retain artifacts. Archive or remove a workflow by moving/deleting its feature directory manually after review. State writes use revision checks and locks; if another session is updating the same feature, retry after inspecting its state.
