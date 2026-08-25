---
name: nodejs-project-tooling
description: Shared tooling configuration for Node.js projects — ESLint, Prettier, git hooks, CI/CD, and dependency management
---

# Node.js Project Tooling

## Overview

This skill provides tooling configuration shared across all Node.js project archetypes. Load it alongside an archetype skill (e.g., `nodejs-project-simple-api`) for a complete project setup.

Configurations here align with `nodejs-code-style` and `typescript-code-style` — load those for detailed rule rationale and do/don't examples.

> **Dependency versions are examples only.** The `package.json` snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

---

## ESLint (Flat Config — ESLint 9+)

`eslint.config.js`:

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
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
);
```

- Flat config (ESLint 9+) is the modern standard — `.eslintrc.*` is deprecated
- `typescript-eslint` with `strictTypeChecked` catches type-level errors at lint time
- `eslint-config-prettier` disables rules that conflict with Prettier
- See `typescript-code-style` for the strict mode rationale

---

## Prettier

`.prettierrc.json`:

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

`.prettierignore`:

```
node_modules/
dist/
build/
coverage/
*.log
.env
.env.local
```

See `nodejs-code-style` for rationale on each option.

---

## Git Hooks

### Husky + lint-staged

```bash
pnpm add -D husky lint-staged
pnpm exec husky init
```

`.husky/pre-commit`:

```bash
pnpm exec lint-staged
```

`package.json` (add to existing):

```json
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"],
    "*.json": ["prettier --write"]
  }
}
```

Ensures every commit is formatted and lint-free. If a hook fails, fix the issue and amend or recommit.

---

## `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

Place at project root. Most editors pick this up automatically — no plugin needed for basic support.

---

## Conventional Commits

Format: `type(scope): description`

| Type     | Usage                       |
|----------|-----------------------------|
| `feat`   | A new feature               |
| `fix`    | A bug fix                   |
| `chore`  | Maintenance, tooling, deps  |
| `refactor` | Code change, no behavior change |
| `docs`   | Documentation only          |
| `test`   | Adding or fixing tests      |

Example: `feat(api): add user creation endpoint`

Why: enables automatic changelog generation, semantic versioning, and readable history.

---

## Dependency Management

### Renovate (recommended)

`renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "automerge": true,
  "automergeType": "pr",
  "major": {
    "automerge": false
  },
  "packageRules": [
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true
    }
  ]
}
```

### Dependabot (GitHub-native alternative)

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
```

Renovate is preferred — more configurable, faster, and supports monorepos better. Dependabot is simpler if you want zero-config.

---

## CI/CD

`.github/workflows/ci.yml`:

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

Three distinct checks (`lint`, `type-check`, `test`) so a single failure doesn't hide others. `build` runs last since it's the most expensive.

For npm users, replace `pnpm` with `npm` and use `npm ci --frozen-lockfile` or just `npm ci`. For Yarn, use `yarn install --frozen-lockfile`.

---

## `.gitignore`

```
node_modules/
dist/
.env
.env.local
*.log
coverage/
```
