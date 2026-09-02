---
name: nodejs-project-boilerplate
description: Index of Node.js project archetypes — helps you choose the right project structure and load the matching scaffolding skill
---

# Node.js Project Boilerplate

## Overview

This is the entry point for scaffolding Node.js projects. Use the table below to choose the archetype that matches your needs, then load the corresponding skill.

All archetypes share a common tooling foundation provided by `nodejs-project-tooling` (ESLint, Prettier, git hooks, CI/CD, dependency management). Configurations across skills align with `nodejs-code-style` and `typescript-code-style`.

## Archetype Decision Table

| Archetype | Best For | Key Trade-off | Load This Skill |
|-----------|----------|---------------|-----------------|
| **Simple API Server** | REST/GraphQL backend, microservice | Simplicity vs. feature richness | `nodejs-project-simple-api` |
| **Full-Stack App** | Server-rendered or SPA + API | Cohesion vs. deploy coupling | `nodejs-project-fullstack` |
| **Library / Package** | npm-publishable utility or SDK | Bundle size vs. compatibility | `nodejs-project-library` |
| **Monorepo** | Multi-package project, shared code | Dependency management overhead | `nodejs-project-monorepo` |

## Related Skills

| Skill | Covers |
|-------|--------|
| `nodejs-project-tooling` | Shared tooling configs — ESLint, Prettier, git hooks, CI/CD, dependency management |
| `nodejs-code-style` | Code style rules, naming conventions, error handling patterns, testing conventions |
| `typescript-code-style` | Strict mode config, discriminated unions, generics, immutability, utility types |
| `react-code-style` | React component patterns, hooks, forms, testing |
| `react-code-guidelines` | Full React project architecture, data fetching, auth, performance |

## Package selection with the npm-registry MCP

The archetype and package choices below are starting points, not immutable recommendations. Before installing or recommending any npm package, query the configured `npm-registry` MCP server for current metadata.

| MCP tool | Use it for |
|----------|------------|
| `npm-registry_search_packages` | Discover candidates by keyword |
| `npm-registry_get_package_info` | Latest version, license, dependencies, maintainers |
| `npm-registry_compare_packages` | Side-by-side comparison (downloads, maintenance, quality) |
| `npm-registry_check_vulnerabilities` | Security check before installing a version |

Suggested workflow:

1. Search candidates.
2. Compare the most promising 2–3.
3. Inspect the chosen package’s latest version.
4. Check that version for known vulnerabilities.
5. Install the latest stable release unless a compatibility constraint requires pinning.

Example call shape:

```javascript
mcp({
  tool: 'npm-registry_search_packages',
  args: { query: 'hono fastify express', limit: 5 }
});
```

Prefer actively maintained packages with a healthy maintenance score and no known vulnerabilities. Do not copy example versions from any skill verbatim — always resolve the current latest stable release.
