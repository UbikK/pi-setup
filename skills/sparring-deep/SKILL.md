---
name: sparring-deep
description: Deep sparring protocol for far-reaching decisions — architecture, dependencies, public APIs, security boundaries, data models, or anything that would be expensive to undo.
---
# Deep Sparring Protocol

Loaded when you signal `? ` intensity (question mark + space).

Use this for far-reaching decisions — architecture, dependencies, public APIs, security boundaries, data models, or anything that would be expensive to undo. The `? ` prefix is stripped before I read the rest of your prompt.

## Step 0: Project Context Check

Load the `project-context` skill. Check for `PROJECT_CONTEXT.md` (or `.project-context.md`, `docs/project-context.md`) and whether it is within its `review_interval_days`.
- **If missing**: Ask the context questions below, then create the file at `PROJECT_CONTEXT.md` following the `project-context` schema.
- **If stale**: Flag with *"Project context may be outdated — want to refresh it before I recommend?"*
- **If fresh**: Preface recommendations with *"Based on project context..."*

For the full schema, decision-log rules, and solo/team workflow differences, see `project-context`.

Context questions to ask (single message):

```
## Team
- How many maintainers?
- How often do you deploy?
- Who's the audience (internal tool / customer-facing / OSS)?

## Codebase
- Maturity: greenfield / established / legacy migration?
- Any patterns you're actively migrating away from?

## Performance & Scale
- Latency-sensitive? (p99 target?)
- Current users / data volume?
- Growth trajectory (next 6 months)?

## Quality
- Testing culture: coverage target? TDD? integration-heavy?
- CI pipeline? Formal PR review?

## Preferences
- Default intensity: light or deep?
- Any frameworks/libs to prefer or avoid?
- Verbose or terse code style?
```

## Step 1: Understand & Challenge

Before any code:
- Ask probing questions about the requirement
- Challenge assumptions: "Why this approach? Have you considered...?"
- Never rubber-stamp without exploring trade-offs
- Be respectful but direct — push back with reasoning

## Step 2: Propose Architectural Alternatives

Present 2–3 approaches using the Trade-off Card Format:

```markdown
### Approach A: [Pattern/Name]
| Dimension | Assessment |
|-----------|------------|
| **Effort** | XS / S / M / L / XL |
| **Complexity delta** | +0 (same) / +1 (local) / +2 (systemic) |
| **Test impact** | Few new / Moderate / Heavy |
| **Key risk** | 1-sentence highest-concern risk |
| **Best for** | When [condition] is true |

**Pros:** [2-3 bullet]
**Cons:** [2-3 bullet]
**Decision:** [Recommended? Why/why not?]
```

Ground recommendations in project context (team size, deploy frequency, codebase maturity, performance requirements, scale).

### Evaluating library vs. custom-code alternatives

When one of the alternatives is “use an existing npm package” vs. “write it ourselves,” use the configured `npm-registry` MCP to evaluate the package side with real data.

| MCP tool | Use it for |
|----------|------------|
| `npm-registry_search_packages` | Discover candidate libraries by capability |
| `npm-registry_get_package_info` | Latest version, license, dependencies, maintainer health |
| `npm-registry_compare_packages` | Compare leading libraries on downloads, maintenance, quality |
| `npm-registry_check_vulnerabilities` | Security check before recommending a version |

How to fold this into the trade-off card:

1. **Estimate custom-code effort** — implementation, tests, docs, ongoing maintenance.
2. **Search for an npm alternative** and compare the top 2–3 candidates.
3. **Inspect the chosen package** for dependency count, bundle size implications, and license compatibility.
4. **Check the latest version** for known vulnerabilities.
5. **Weight the choice** in the trade-off card: library effort saved vs. dependency risk, lock-in, API fit, and whether the package does more than you need.

Example call shape:

```javascript
mcp({
  tool: 'npm-registry_search_packages',
  args: { query: 'date-fns luxon moment', limit: 5 }
});
```

Default to writing from scratch only when the problem is small, stability-critical, or no well-maintained package exists. Otherwise, prefer a low-dependency, actively maintained library with no known vulnerabilities — and always resolve the latest stable version rather than copying old examples.

## Step 3: Pre-Mortem

Walk through before committing to an approach:

1. **Failure mode**: "If this breaks in production, what's the most likely cause?"
2. **Rollback**: "Can we revert without data loss or migration?"
3. **Assumption log**: 2-3 assumptions this approach depends on
4. **Observability**: "Will we know it's broken before the user does?"
5. **Security boundary**: "Does this cross a trust boundary or handle user data?"
6. **Hot path**: "Could this be in a request path? What's the perf profile?"
7. **State mutation**: "Does this change shared state? Is it idempotent?"

## Step 4: Code — Minimal + Clear

- No over-engineering. Avoid unnecessary abstractions.
- Self-documenting names and structure.
- Concise but readable — one statement per line, avoid nesting hell.
- Comments only when *why* is non-obvious (never *what*).
- Follow established conventions. When none exist, load the relevant style skill (e.g., `skill({ name: "csharp-code-style" })`).
- Structure for testability.
- Be pragmatic over perfect.

## Step 5: Disagreement Protocol

If I recommend A and you prefer B:

1. **Acknowledge** your preference, restate my concern in 1 sentence.
2. **Offer a mitigated version**: "If we go B, let's at least [guard rail] to cover [risk]."
3. **Document** the decision and surfaced risk.
4. **Commit to B** — don't drag the debate into implementation.

Exception: If B introduces a security vulnerability or data loss risk, escalate with specific evidence.

## Step 6: Post-Implementation Check

After code is written, revisit:
- Were the pre-mortem risks still relevant?
- Did the complexity estimate match reality?
- Any new concerns surfaced during implementation?

## Code Style Expectations

- **C#**: Modern features (records, nullable reference types, LINQ), Microsoft naming conventions, async-first, DI, structured logging
- **TypeScript**: Strict mode, discriminated unions, avoid `any`, prefer immutability
- **Node.js**: Async/await, error handling, avoid callback hell
- **React**: Server components by default (React 19+), client components by necessity. Use `useActionState` for forms, `useOptimistic` for optimistic updates. Props over state where possible. Co-locate tests.
- **PlantUML / C4**: Propose C4 context/container diagrams for architecture discussions. Keep under 30 elements; split into sub-diagrams otherwise. Use `!include` for shared elements, `!theme` for styling.
- **Testing**: Match existing project strategy. Default: integration over unit for I/O-bound code, unit over integration for pure logic. Don't test trivial getters/setters.
