---
name: nodejs-project-monorepo
description: Scaffolding for multi-package workspaces — workspace configuration, build orchestration, shared tooling, and release management
---

# Monorepo

## Overview

This skill covers setting up a pnpm-based monorepo with Turborepo for build orchestration. It works alongside archetype skills for individual packages (e.g., a monorepo containing an API server + shared library).

**Prerequisite:** Load `nodejs-project-tooling` for shared tooling configs. Cross-references `nodejs-project-library` for package patterns, `nodejs-project-simple-api` for API patterns, and `react-code-guidelines` / `react-code-style` for frontend packages.

> **Dependency versions are examples only.** The `package.json` snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

---

## Orchestrator Decision

| Dimension | Turborepo | Nx | pnpm workspaces only |
|-----------|-----------|-----|----------------------|
| **Setup effort** | Low — add `turbo.json` | Medium — requires Nx plugin config | Minimal — just `pnpm-workspace.yaml` |
| **Build caching** | Local + remote (Vercel) | Local + remote (Nx Cloud) | None — each package builds independently |
| **Task orchestration** | Declarative pipeline in `turbo.json` | Declarative + dependency graph analysis | Manual — `--filter` flags |
| **Parallelism** | Automatic | Automatic | Manual |
| **Learning curve** | Low — conventions over config | Medium — powerful but more concepts | Low — just workspace commands |
| **Verdict** | **Recommended** — best balance of power and simplicity | Good for large-scale monorepos (>20 packages) | Consider for <5 packages, simple build chains |

---

## Directory Layout

```
project-root/
  packages/
    shared/          # Types, validation schemas, utilities
    api/             # Hono API server
    web/             # Vite + React SPA
  tools/
    eslint/          # Shared ESLint config package
    typescript/      # Shared tsconfig bases
  turbo.json
  pnpm-workspace.yaml
  package.json       # Root — scripts, shared devDeps
  eslint.config.js   # See nodejs-project-tooling
  .prettierrc.json   # See nodejs-project-tooling
```

---

## Config Files

### Root `package.json`

```json
{
  "name": "@scope/monorepo",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test",
    "type-check": "turbo type-check",
    "format": "prettier --write .",
    "changeset": "changeset",
    "release": "changeset publish"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "@changesets/cli": "^2.27.0",
    "eslint-config-prettier": "^9.0.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- Root `devDependencies` — tools shared across all packages
- Per-package dependencies go in each package's own `package.json`
- `packageManager` field — enforces the correct pnpm version

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
  - 'tools/*'
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"],
      "inputs": ["src/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "type-check": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["build"],
      "inputs": ["src/**", "tests/**"]
    }
  }
}
```

- `dependsOn: ["^build"]` — builds dependencies before building the dependent
- `outputs` — tells Turborepo which files to cache
- `inputs` — determines cache invalidation (which files trigger a rebuild)
- `persistent: true` for `dev` — keeps the dev server running

### Root `tsconfig.json` (base config)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Per-package `tsconfig.json` extends the root:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

---

## Shared Tooling Package

`tools/eslint/package.json`:

```json
{
  "name": "@scope/eslint-config",
  "private": true,
  "main": "index.js",
  "peerDependencies": {
    "eslint": "^9.0.0"
  }
}
```

`tools/eslint/index.js` — re-exports the config from `nodejs-project-tooling`, adapted for the monorepo:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
);
```

Each package references the shared config:

```json
// packages/api/package.json
{
  "name": "@scope/api",
  "eslintConfig": {
    "root": true,
    "extends": ["@scope/eslint-config"]
  }
}
```

---

## Package Dependency Pattern

```
@scope/web  ──depends on──▶  @scope/shared  (types, API client)
@scope/api  ──depends on──▶  @scope/shared  (types, validation schemas)
```

```json
// packages/web/package.json
{
  "name": "@scope/web",
  "dependencies": {
    "@scope/shared": "workspace:*"
  }
}
```

- `workspace:*` — pnpm resolves this to the local package, not the registry
- During publishing, changesets replaces `workspace:*` with the published version

---

## CI/CD with Caching

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm type-check
      - run: pnpm test
      - run: pnpm build
```

Turborepo caches results locally by default. For remote caching (shared across CI runs), connect a remote cache:

```bash
pnpm add -D @turbo/cache
turbo login    # Link Vercel account
```

Or use the built-in GitHub Actions cache with `turbo`:

```yaml
- uses: actions/cache@v4
  with:
    path: node_modules/.cache/turbo
    key: turbo-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
```

This makes CI incremental — only changed packages and their dependents rebuild.

---

## Release Strategy

### Changesets

```bash
pnpm add -D @changesets/cli
pnpm changeset init
```

`.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "access": "restricted",
  "baseBranch": "main"
}
```

Workflow:

```bash
pnpm changeset    # Select packages and bump type → generates .md file
pnpm changeset version  # Consumes .md files, updates versions + changelogs
pnpm release            # Publishes updated packages to npm
```

### Release CI

```yaml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
      - uses: changesets/action@v1
        with:
          publish: pnpm release
          version: pnpm changeset version
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Only publishes packages that have changed — unchanged packages stay at their current version.

---

## Quick-Start

```bash
# 1. Scaffold
mkdir my-monorepo && cd my-monorepo
git init
pnpm init

# 2. Install root tools
pnpm add -D turbo typescript eslint prettier @changesets/cli eslint-config-prettier

# 3. Create workspace configs
#    pnpm-workspace.yaml, turbo.json
#    Root tsconfig.json, eslint.config.js, .prettierrc.json

# 4. Create packages
mkdir -p packages/shared/src
mkdir -p packages/api/src
mkdir -p packages/web/src
# See nodejs-project-library for shared package setup
# See nodejs-project-simple-api for API setup
# See nodejs-project-fullstack for SPA setup
# See react-code-style and react-code-guidelines for frontend patterns

# 5. Verify
pnpm lint && pnpm type-check && pnpm test && pnpm build

# 6. First commit
git add . && git commit -m "chore: scaffold monorepo"
```

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `nodejs-project-tooling` | Shared tooling configs — ESLint, Prettier, git hooks, CI/CD |
| `nodejs-project-library` | Package scaffolding for individual packages |
| `nodejs-project-simple-api` | API server scaffolding |
| `nodejs-project-fullstack` | Full-stack patterns for SPA or Next.js packages |
| `typescript-code-style` | TypeScript strict mode, type patterns |
| `nodejs-code-style` | Code style rules, naming conventions |
| `react-code-style` | React component patterns, hooks, forms, testing |
| `react-code-guidelines` | React project architecture, data fetching, auth, performance |
