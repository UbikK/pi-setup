---
name: nodejs-project-library
description: Scaffolding for npm-publishable libraries — build pipeline, dual CJS/ESM output, testing, documentation, and release automation
---

# Library / Package

## Overview

This skill covers publishing a TypeScript library to npm. It applies to utility packages, SDKs, component libraries, and shared code between projects.

**Prerequisite:** Load `nodejs-project-tooling` for shared tooling configs. Configurations here align with `typescript-code-style` and `nodejs-code-style`.

> **Dependency versions are examples only.** The `package.json` snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

---

## Build Tool Decision

| Dimension | tsup | tsc | bun build |
|-----------|------|-----|-----------|
| **Speed** | Fast (esbuild-based) | Slow (full compilation) | Fastest (Zig-based) |
| **Output formats** | ESM + CJS, code splitting | ESM or CJS, one at a time | ESM only |
| **DTS generation** | Bundles `.d.ts` (or uses `tsc`) | Native `.d.ts` output | No DTS — use `tsc` separately |
| **Configuration** | Minimal — zero-config for most | Standard `tsconfig.json` | Minimal — no config file |
| **Bundle externals** | Configurable peer deps | Manual via `tsc` + `package.json` | Automatically externalizes deps |
| **Verdict** | **Recommended** — fast, dual output, minimal config | Good when you want full TS control | Consider for Bun-native libraries |

---

## Output Format Decision

| Dimension | ESM Only | Dual (ESM + CJS) | CJS Only |
|-----------|----------|-------------------|----------|
| **Bundle size** | Smallest | Largest (two builds) | Medium |
| **Compatibility** | Node 16+, browsers | All environments | CommonJS-only consumers |
| **Tree-shaking** | Yes | Partial (CJS can't tree-shake) | No |
| **Config complexity** | Low | Higher — need two tsconfigs or build tool | Low |
| **Verdict** | **Recommended** for new libraries targeting modern runtimes | Required if consumers may use `require()` | Avoid for new libraries |

---

## Directory Layout

```
project-root/
  src/
    index.ts         # Public API — only what consumers should import
    internal/        # Private — not exported
  tests/
    unit/
  dist/              # Build output (gitignored)
  eslint.config.js   # See nodejs-project-tooling
  .prettierrc.json   # See nodejs-project-tooling
  tsconfig.json
  tsconfig.build.json
  package.json
  README.md
```

- `src/index.ts` is the single entry point — consumers import from `@scope/package`, never from subpaths
- `internal/` holds implementation details that are never exported

---

## Config Files

### `package.json`

```json
{
  "name": "@scope/package",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "eslint src/ tests/",
    "format": "prettier --write .",
    "test": "vitest run",
    "type-check": "tsc --noEmit",
    "prepublishOnly": "pnpm build && pnpm test"
  },
  "dependencies": {},
  "peerDependencies": {
    "typescript": "^5.5.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "eslint-config-prettier": "^9.0.0",
    "prettier": "^3.0.0"
  }
}
```

- `exports` field is the modern entry point — `main`/`module` are fallbacks for older bundlers
- `files: ["dist"]` — only publish the built output, not source or tests
- `prepublishOnly` hook ensures build + test pass before publishing
- Put runtime dependencies in `dependencies`; type-system-only deps like `typescript` go in `peerDependencies`

### `tsconfig.json` (for type-checking and IDE)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- `noEmit: true` — tsc is used for type-checking only; `tsup` handles output

### `tsup.config.ts`

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
});
```

- `dts: true` generates `.d.ts` type declarations
- `splitting: false` — keeps the output as a single file per format (good for libraries)
- No `external` needed by default — tsup auto-externalizes packages from `dependencies` and `peerDependencies`

---

## API Surface Design

```typescript
// src/index.ts — public API
export { UserService } from './user-service';
export type { User, CreateUserInput } from './types';

// Internal — not exported
// import { hashPassword } from './internal/crypto';
```

- Export only what consumers need
- Use `type` export modifier for type-only exports so bundlers can tree-shake them
- Never export implementation details — they become breaking changes if removed

### Documentation

```typescript
/**
 * Normalizes an email address: trims whitespace and lowercases.
 * Throws if the input is not a valid email.
 *
 * @example
 * normalizeEmail('  USER@Example.COM  ') // => 'user@example.com'
 */
export function normalizeEmail(email: string): string {
  // ...
}
```

- Use JSDoc for all public API — this feeds TypeDoc / api-extractor output
- Include `@example` tags — they double as documentation tests
- No JSDoc on internal functions unless the *why* is non-obvious

---

## Testing for Libraries

```typescript
// tests/unit/normalize-email.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeEmail } from '../../src';

describe('normalizeEmail', () => {
  it('trims whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('lowercases the domain', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('throws on invalid email', () => {
    expect(() => normalizeEmail('not-an-email')).toThrow();
  });
});
```

- Unit-test all public API functions — the public surface is your contract
- Integration tests only for I/O-bound code (file system, network)
- No need for test database or setup unless the library depends on one

---

## Release Automation

### Changesets (recommended)

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
  "access": "public",
  "baseBranch": "main"
}
```

Workflow:

```bash
# When making changes
pnpm changeset        # Describe the change (major/minor/patch)
git add . && git commit -m "feat: add normalizeEmail"
git push

# CI detects changeset files → creates PR → merge → publish
```

`.github/workflows/release.yml`:

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
          publish: pnpm publish -r
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Semantic release is an alternative. Changesets is preferred for monorepos and human-readable changelogs.

---

## Quick-Start

```bash
# 1. Scaffold
mkdir my-lib && cd my-lib
git init
pnpm init

# 2. Install
pnpm add -D typescript tsup vitest eslint prettier @eslint/js typescript-eslint eslint-config-prettier @changesets/cli

# 3. Create files from templates above
#    src/index.ts, tsup.config.ts, tsconfig.json
#    eslint.config.js, .prettierrc.json  (from nodejs-project-tooling)

# 4. Create first release
pnpm changeset init
git add . && git commit -m "chore: scaffold library"
git push
```

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `nodejs-project-tooling` | Shared tooling configs — ESLint, Prettier, git hooks, CI/CD |
| `typescript-code-style` | Strict mode config, type patterns, branded types |
| `nodejs-code-style` | Code style rules, naming conventions, error handling |
