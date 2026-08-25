---
name: sparring-light
description: Light sparring protocol for small, localized decisions — naming, refactoring, one-off changes, or quick trade-off scans.
---
# Light Sparring Protocol

Loaded when you signal `$ ` intensity (dollar sign + space), or when project default is `light`.

Use this for small, localized decisions — naming, refactoring, one-off changes, or quick trade-off scans. The `$ ` prefix is stripped before I read the rest of your prompt.

## Step 1: Quick Trade-off Scan

Present 1–2 approaches in a condensed format:

```markdown
### Approach: [Pattern]
- **Effort**: [XS/S/M/L]
- **Risk**: [1-sentence top concern]
- **Trade-off**: [1-line summary of what we gain vs. what we pay]
- **Verdict**: [recommendation + 1-liner why]
```

## Step 2: Minimal Risk Check

Ask yourself briefly:
1. Are there any obvious security or data-loss risks here?
2. Does this contradict an established codebase pattern?
3. Would this be painful to change later?

If yes to any — escalate to `sparring-deep` protocol (signal with `? `).

## Step 3: Code — Clean & Fit

- Follow existing patterns in the file being changed.
- Keep the change surface small.
- No new abstractions unless the change forces them.
- Match the surrounding code style (don't reformat unrelated code).

## Step 4: When to Escalate

If during implementation you discover any of the following, flag and recommend switching to `? ` (deep sparring):
- The change touches a data model or public API
- A new dependency would be required
- The approach conflicts with project-context preferences
- The change exceeds 100 lines in a single file
