---
name: nodejs-project-simple-api
description: Scaffolding for REST/GraphQL API servers — stack decisions, directory layout, core patterns, and Docker deployment
---

# Simple API Server

## Overview

This skill scaffolds a standalone API server (REST or GraphQL). It covers the entire setup from stack selection through production deployment.

**Prerequisite:** Load `nodejs-project-tooling` for shared tooling configs (ESLint, Prettier, git hooks, CI/CD). Configurations here align with `nodejs-code-style` and `typescript-code-style`.

> **Dependency versions are examples only.** The `package.json` snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

---

## Stack Decision Matrix

### Runtime

| Dimension | Node.js 22+ | Bun | Deno |
|-----------|-------------|-----|------|
| **Ecosystem** | Full npm, all packages work | Most npm packages work | Growing, subset of npm |
| **Performance** | Good (improving with each release) | Excellent (Zig-based) | Good (Rust-based) |
| **TypeScript** | Requires `tsx` or compile step | Native, no config | Native, no config |
| **Standard library** | Minimal (growing) | Built-in test runner, SQLite | Extensive built-in APIs |
| **Operational maturity** | Most mature — monitoring, logging, profiling | Improving — still gaps | Improving — niche |
| **Verdict** | **Recommended** — widest ecosystem, best operational tooling | Consider for perf-critical APIs | Consider if targeting Deno Deploy |

### Framework

| Dimension | Express | Fastify | Hono |
|-----------|---------|---------|------|
| **Maturity** | Most mature, largest ecosystem | Mature, production-proven | Newer but stable (v4+) |
| **Performance** | Adequate (10-15k req/s) | Excellent (30-50k req/s) | Excellent (40-60k req/s) |
| **TypeScript DX** | Requires `@types/express`, manual inference | Good — schema-based serialization | Best — first-class TS, strong inference |
| **Bundle size** | ~200KB (minimal) | ~500KB (plugin ecosystem) | ~60KB (ultralight) |
| **Middleware ecosystem** | Vast — every pattern available | Large — compatible with Express via plugin | Growing — adapter pattern |
| **Verdict** | Solid default, known by most teams | **Recommended** for perf-critical APIs | Recommended for edge/Cloudflare, small services |

### ORM

| Dimension | Prisma | Drizzle | Kysely |
|-----------|--------|---------|--------|
| **Type safety** | Excellent — generated client | Excellent — inferred from schema | Very good — inferred from builder |
| **Migrations** | Built-in, declarative | Built-in, imperative | Manual / external tool |
| **Query API** | Prisma-specific DSL | SQL-like API | SQL-like API |
| **Bundle size** | Heavy — client + engine (~15MB) | Minimal (~100KB) | Minimal (~50KB) |
| **CLI speed** | Slow — generates client each time | Fast — no code generation needed | Fast — no generation |
| **Verdict** | Best DX, great for complex schemas | **Recommended** — lightweight, SQL close | Best for raw SQL control |

### Testing

| Dimension | Vitest | Jest | Node Test Runner |
|-----------|--------|------|------------------|
| **Speed** | Fast (ESM-native, Vite-powered) | Slower (CommonJS transform overhead) | Fastest (no deps) |
| **API compatibility** | Jest-compatible API | Industry standard | Minimal, not drop-in compatible |
| **TypeScript support** | Native (via Vite) | Requires `ts-jest` or `babel` | Native (with `--loader tsx`) |
| **Mocking** | Built-in (compatible with Jest) | Built-in | Requires `node:test` mock (limited) |
| **Ecosystem** | Growing rapidly | Largest | Small |
| **Verdict** | **Recommended** — best DX, fast, compatible | Good for existing Jest projects | Consider for dependency-light projects |

### Package Manager

| Dimension | npm | pnpm | Yarn |
|-----------|-----|------|------|
| **Install speed** | Slowest | Fast (hard links, content-addressable) | Medium |
| **Disk usage** | Highest (duplicates per project) | Lowest (single store + hard links) | Low (cached) |
| **Monorepo support** | Workspaces (basic) | Workspaces (great, strict isolation) | Workspaces (good, Berry) |
| **Strictness** | Loose — phantom dependencies possible | Strict — requires explicit deps | Medium |
| **Compatibility** | Universal | Most packages work | Most packages work |
| **Verdict** | Avoid — use pnpm or Yarn | **Recommended** — fast, strict, disk-efficient | Good alternative, especially with Berry |

---

## Directory Layout

```
project-root/
  src/
    routes/          # Route handlers
    middleware/      # Express/Fastify/Hono middleware
    services/        # Business logic
    db/              # Database schema, migrations, client
    config/          # Environment config, constants
    utils/           # Pure utility functions
    app.ts           # App factory (middleware, routes, plugins)
    server.ts        # HTTP server bootstrap (listen, graceful shutdown)
  tests/
    integration/
    unit/
  docker/
  scripts/
  eslint.config.js   # See nodejs-project-tooling
  .prettierrc.json   # See nodejs-project-tooling
  tsconfig.json
  .env.example
  .gitignore
  Dockerfile
  docker-compose.yml
  package.json
```

Follows the feature-based organization from `nodejs-code-style`. Routes map to endpoints, services hold domain logic, utilities are pure functions with no side effects.

---

## Config Files

### `package.json`

```json
{
  "name": "@scope/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "lint": "eslint src/ tests/",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0",
    "pino": "^9.0.0",
    "zod": "^3.23.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.0.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "eslint-config-prettier": "^9.0.0",
    "prettier": "^3.0.0",
    "pino-pretty": "^11.0.0"
  }
}
```

- `"type": "module"` — ESM is the standard in 2025+
- `tsx` for dev — runs TS directly without compile step, matches `node --watch` behavior
- `tsc` for build — emits to `dist/` for production
- `vitest` over Jest — see comparison table above

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- `NodeNext` module resolution — required for ESM with `"type": "module"`
- `strict: true` — see `typescript-code-style` for full strict mode rationale
- `declaration: true` — produces `.d.ts` files even for apps (useful for cross-project references)
- `sourceMap: true` — maps stack traces back to TS in production

### `.env.example`

```env
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# Logging
LOG_LEVEL=debug
```

### Configuration Schema (`src/config/env.ts`)

```typescript
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

Fail fast: validate on import so invalid config never reaches runtime.

---

## Core Patterns

### App Factory (`src/app.ts`)

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from './middleware/request-id';
import { errorHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import { apiRouter } from './routes/api';

export function createApp() {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', requestId);
  app.onError(errorHandler);
  app.route('/healthz', healthRouter);
  app.route('/api/v1', apiRouter);

  return app;
}
```

App creation (no side effects) is separated from server bootstrap (side effects). This makes testing easier — create the app without binding to a port.

### Graceful Shutdown (`src/server.ts`)

```typescript
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

const app = createApp();

const server = serve({
  fetch: app.fetch,
  port: env.PORT,
  hostname: env.HOST,
}, (info) => {
  logger.info({ port: info.port }, 'Server started');
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');
  server.close();
  // Close DB connections, background jobs, etc.
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- Handles `SIGTERM` (Kubernetes, Docker stop) and `SIGINT` (Ctrl+C)
- Drains connections before exit — avoids in-flight request loss

### Global Error Handler

```typescript
import type { ErrorHandler } from 'hono';
import { StatusCode } from 'hono/utils/http-status';
import { logger } from '../utils/logger';
import { AppError } from '../utils/app-error';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { error: { message: err.message, code: err.code } },
      err.statusCode as StatusCode,
    );
  }

  logger.error({ err }, 'Unhandled error');

  return c.json(
    { error: { message: 'Internal server error' } },
    500,
  );
};
```

- Domain errors return structured, safe responses
- Unexpected errors are logged with full context and return a generic 500
- Never leak internal error details to clients

### Custom Error Class

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}
```

See `nodejs-code-style` for more on custom error class patterns.

### Health Check Routes

```typescript
import { Hono } from 'hono';

const healthRouter = new Hono();

healthRouter.get('/', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }),
);

healthRouter.get('/ready', (c) =>
  c.json({
    status: 'ok',
    database: 'connected',
  }),
);
```

- `/healthz` — liveness probe (is the process alive?)
- `/readyz` — readiness probe (can it serve traffic? checks dependencies)

### Structured Logger

```typescript
import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
```

- Production: pure JSON (structured, machine-parseable) — no transport
- Development: pretty-printed with `pino-pretty` for readability

### Route Registration

```typescript
// src/routes/api/users.ts
export const userRouter = new Hono()
  .get('/', async (c) => {
    const users = await userService.list();
    return c.json(users);
  })
  .post('/', async (c) => {
    const body = await c.req.json();
    const user = await userService.create(body);
    return c.json(user, 201);
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = await userService.getById(id);
    return c.json(user);
  });

// src/routes/api.ts
import { Hono } from 'hono';
import { userRouter } from './api/users';

export const apiRouter = new Hono()
  .route('/users', userRouter);
```

- Route handlers only parse input and return responses — no business logic
- Services handle domain logic
- One file per resource, mounted via parent router

### Test Setup

```typescript
// tests/setup.ts
import { beforeAll, afterAll } from 'vitest';

beforeAll(async () => {
  // Run migrations, seed data, etc.
});

afterAll(async () => {
  // Cleanup
});
```

```typescript
// tests/integration/health.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app';

const app = createApp();

describe('GET /healthz', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });
});
```

- Integration tests hit the app factory directly (no network overhead)
- Unit tests test services with mocked dependencies
- See `nodejs-code-style` for test naming and assertion conventions

---

## Docker & Deployment

### `Dockerfile` (Multi-Stage)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
```

- Multi-stage: builder has devDeps, runner only needs production deps
- Non-root user for security
- `--frozen-lockfile` ensures reproducible builds

### `docker-compose.yml`

```yaml
services:
  api:
    build: .
    ports:
      - '3000:3000'
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://user:password@db:5432/app
    depends_on:
      db:
        condition: service_healthy
    develop:
      watch:
        - path: ./src
          action: sync

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: app
    ports:
      - '5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready']
      interval: 5s
      timeout: 3s
      retries: 5
```

- Docker Compose watch for hot-reload in dev (v2.22+)
- DB health check ensures the API doesn't start before the database is ready

---

## Quick-Start Checklist

```bash
# 1. Create project
mkdir my-api && cd my-api
git init
pnpm init

# 2. Install dependencies
pnpm add hono @hono/node-server pino zod dotenv
pnpm add -D typescript tsx vitest eslint prettier @eslint/js typescript-eslint eslint-config-prettier pino-pretty

# 3. Load skills
#    skill({ name: "nodejs-project-tooling" })   — ESLint, Prettier, git hooks, CI/CD
#    skill({ name: "nodejs-project-simple-api" })   — this file

# 4. Create files from templates above
#    src/app.ts, src/server.ts, src/config/env.ts
#    src/middleware/error-handler.ts, src/utils/logger.ts, src/utils/app-error.ts
#    src/routes/health.ts, src/routes/api.ts, src/routes/api/users.ts
#    tsconfig.json, .env.example, .gitignore, Dockerfile, docker-compose.yml

# 5. Add tooling configs
#    eslint.config.js, .prettierrc.json    (from nodejs-project-tooling)
#    .husky/pre-commit, renovate.json      (from nodejs-project-tooling)
#    .github/workflows/ci.yml              (from nodejs-project-tooling)

# 6. Verify
pnpm format && pnpm lint && pnpm type-check && pnpm test

# 7. First commit
git add . && git commit -m "chore: scaffold api server"

# 8. Deploy
#    Push to GitHub → connect to Railway / Fly.io / Render / your infra
#    Set environment variables → deploy
```
