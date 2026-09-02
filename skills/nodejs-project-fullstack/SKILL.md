---
name: nodejs-project-fullstack
description: Scaffolding for full-stack applications — monolithic vs. separated patterns, shared types, dev proxy, testing, and deployment
---

# Full-Stack App

## Overview

This skill covers two patterns for full-stack Node.js applications:

- **Pattern A: Monolithic (Next.js)** — single framework handles frontend + API routes
- **Pattern B: Separated (SPA + API)** — independent frontend and backend, typically in a monorepo

**Prerequisite:** Load `nodejs-project-tooling` for shared tooling configs. This skill cross-references `nodejs-project-simple-api` for API patterns and `react-code-guidelines` / `react-code-style` for frontend conventions.

> **Dependency versions are examples only.** The `package.json` snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

---

## Pattern Decision

| Dimension | Monolithic (Next.js) | Separated (SPA + API) |
|-----------|---------------------|----------------------|
| **Deploy coupling** | One deploy, one process | Independent deploy per service |
| **Shared types** | Trivial — server/client in one tree | Requires shared types package |
| **Scaling** | Scales as one unit | Frontend and backend scale independently |
| **Framework lock-in** | Tied to Next.js conventions | Any frontend + any backend |
| **Dev proxy** | Not needed — built-in routing | Need proxy for API calls in dev |
| **CI/CD complexity** | Simple — one pipeline | N pipelines or matrix |
| **Verdict** | **Recommended** for teams that want fast setup, fewer moving parts | Recommended when frontend/backend teams are independent or scale needs diverge |

---

## Package selection with the npm-registry MCP

The patterns and packages below (Next.js, Vite, Hono, etc.) are starting points. Before installing or recommending any npm package, verify current metadata with the configured `npm-registry` MCP so the choice reflects real ecosystem health and security.

| MCP tool | Use it for |
|----------|------------|
| `npm-registry_search_packages` | Discover candidates by keyword |
| `npm-registry_get_package_info` | Latest version, license, dependencies, maintainers |
| `npm-registry_compare_packages` | Side-by-side comparison (downloads, maintenance, quality) |
| `npm-registry_check_vulnerabilities` | Security check before installing a version |

Suggested workflow:

1. Search candidates for the layer you need (e.g. `nextjs react framework` or `hono express fastify`).
2. Compare the 2–3 finalists.
3. Inspect the chosen package’s latest version.
4. Check that version for known vulnerabilities.
5. Install the latest stable release unless a compatibility constraint requires pinning.

Example call shape:

```javascript
mcp({
  tool: 'npm-registry_search_packages',
  args: { query: 'vite react spa', limit: 5 }
});
```

Prefer actively maintained, low-dependency options with no known vulnerabilities. Do not copy example versions from this skill verbatim — always resolve the current latest stable release.

---

## Pattern A: Monolithic (Next.js)

### Project Structure

```
project-root/
  src/
    app/              # App Router pages and layouts
    components/       # Shared React components
    lib/              # Server utilities, data access
    api/              # API route handlers
    types/            # Shared TypeScript types
  public/
  tests/
    unit/
    integration/
    e2e/
```

### Key Config

`tsconfig.json` — use `next dev` which generates this automatically. Add path aliases:

```json
{
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Data Flow Pattern

```typescript
// src/lib/db.ts — server-only data access
import 'server-only';
import { db } from './db';
import type { User } from '@/types';

export async function getUsers(): Promise<User[]> {
  return db.select().from(users);
}

// src/app/users/page.tsx — server component using it
export default async function UsersPage() {
  const users = await getUsers();
  return <UserList users={users} />;
}
```

- `server-only` marker ensures data-access code never bundles on the client
- Server Components fetch data directly; Client Components fetch from API routes

### Testing

```typescript
// tests/integration/api/users.test.ts
import { describe, it, expect } from 'vitest';

describe('POST /api/users', () => {
  it('creates a user and returns 201', async () => { /* ... */ });
});
```

See `react-code-style` for component testing patterns.

---

## Pattern B: Separated (SPA + Hono API)

### Project Structure (Monorepo)

```
project-root/
  packages/
    shared/           # Shared types, validation schemas
    api/              # Hono API server (see simple-api skill)
    web/              # Vite + React SPA
  eslint.config.js    # See nodejs-project-tooling
  .prettierrc.json    # See nodejs-project-tooling
  package.json
```

### Shared Types Package

`packages/shared/package.json`:

```json
{
  "name": "@scope/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

`packages/shared/src/index.ts`:

```typescript
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
});

export type User = z.infer<typeof UserSchema>;
```

Using `zod` schemas as the single source of truth — types are inferred, never manually duplicated.

### Dev Proxy

`packages/web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

### API Client

`packages/web/src/lib/api.ts`:

```typescript
import type { User, CreateUserInput } from '@scope/shared';

const BASE_URL = '/api/v1';

export async function fetchUsers(): Promise<User[]> {
  const res = await fetch(`${BASE_URL}/users`);
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const res = await fetch(`${BASE_URL}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create user');
  return res.json();
}
```

### CI/CD — Two Pipeline Stages

```yaml
# .github/workflows/ci.yml
jobs:
  shared:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter @scope/shared lint
      - run: pnpm --filter @scope/shared type-check
      - run: pnpm --filter @scope/shared test

  api:
    needs: [shared]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter @scope/api lint
      - run: pnpm --filter @scope/api type-check
      - run: pnpm --filter @scope/api test
      - run: pnpm --filter @scope/api build

  web:
    needs: [shared]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter @scope/web lint
      - run: pnpm --filter @scope/web type-check
      - run: pnpm --filter @scope/web test
      - run: pnpm --filter @scope/web build
```

`shared` runs first since both `api` and `web` depend on it.

---

## Docker (Separated Pattern)

`docker-compose.yml`:

```yaml
services:
  api:
    build: ./packages/api
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://user:password@db:5432/app
    depends_on:
      db:
        condition: service_healthy

  web:
    build: ./packages/web
    ports:
      - '5173:5173'
    depends_on:
      - api

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: app
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready']
```

For monolithic Next.js, a single Dockerfile (same pattern as simple-api) builds the Next.js app.

---

## Quick-Start

```bash
# Pattern A: Monolithic (Next.js)
npx create-next-app@latest my-app --typescript --tailwind --eslint
cd my-app
# See react-code-style and react-code-guidelines for component patterns

# Pattern B: Separated (pnpm monorepo)
mkdir my-app && cd my-app
git init
pnpm init
# Create packages/shared, packages/api, packages/web
# See nodejs-project-tooling for shared configs
# See nodejs-project-simple-api for API setup
```

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `nodejs-project-tooling` | Shared tooling configs — ESLint, Prettier, git hooks, CI/CD |
| `nodejs-project-simple-api` | API server scaffolding (separated pattern) |
| `react-code-style` | React component patterns, hooks, forms, testing |
| `react-code-guidelines` | React project architecture, data fetching, auth, performance |
| `typescript-code-style` | TypeScript strict mode, type patterns |
