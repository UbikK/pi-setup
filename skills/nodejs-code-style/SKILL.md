---
name: nodejs-code-style
description: Node.js code style standards covering ESLint/Prettier configuration, naming conventions, async/await error handling patterns, custom error classes, feature-based project structure, testing patterns, and pre-commit hooks
---

# Node.js Code Style Guide

## Overview
This guide establishes code style standards for Node.js projects using **ESLint** and **Prettier**. The goal is consistency, maintainability, and catching errors early.

> **Dependency versions are examples only.** The `package.json`, ESLint, and Prettier snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

## ESLint Configuration

### Recommended Config (`eslint.config.js`)

```javascript
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/explicit-function-return-types': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-member-accessibility': ['warn', { accessibility: 'explicit' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'eqeqeq': ['error', 'always'],
      'no-implicit-coercion': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'curly': 'error',
      'no-shadow': 'warn',
      'arrow-body-style': ['error', 'as-needed'],
      'prefer-arrow-callback': 'error',
    },
  },
);
```

- Flat config is the ESLint 9+ standard — `.eslintrc.*` is deprecated
- `typescript-eslint` can lint both `.js` and `.ts` files from one config
- Plain JavaScript projects can omit `parserOptions.project` and the TypeScript-specific rules

## Prettier Configuration

### Config (`.prettierrc.json`)
```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

### `.prettierignore`
```
node_modules/
dist/
build/
coverage/
*.log
.env
.env.local
```

## Code Style Rules

### Imports & Exports

✅ **DO**: Group and sort imports
```javascript
// Built-in modules
import fs from 'fs';
import path from 'path';

// Third-party packages
import express from 'express';
import dotenv from 'dotenv';

// Local modules
import { config } from './config.js';
import { logger } from './utils/logger.js';

// Named exports
export function getUserById(id) { /* ... */ }
export const API_VERSION = '1.0.0';

// Default export (use sparingly)
export default class UserService { /* ... */ }
```

❌ **DON'T**: Mix import styles or sort randomly
```javascript
import { config } from './config.js';
import express from 'express';
import fs from 'fs';
import { logger } from './utils/logger.js';
```

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| **Variables, functions** | camelCase | `getUserData`, `calculateTotal` |
| **Constants** | UPPER_SNAKE_CASE | `API_BASE_URL`, `MAX_RETRIES` |
| **Classes** | PascalCase | `UserService`, `DatabaseConnection` |
| **Private methods/fields** | `_prefix` or `#` | `_validateInput()`, `#privateField` |
| **Boolean getters** | `is/has/can` prefix | `isActive`, `hasPermission`, `canDelete` |

### Async/Await & Error Handling

✅ **DO**: Always handle errors with try-catch
```javascript
async function fetchUser(id) {
  try {
    const response = await getUserFromApi(id);
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch user', { id, error: error.message });
    throw new Error(`Unable to fetch user ${id}`);
  }
}
// For callbacks, use error-first pattern
function processFile(path, callback) {
  fs.readFile(path, (error, data) => {
    if (error) {
      return callback(error);
    }
    callback(null, data);
  });
}
```

✅ **DO**: Always prefer Promises and async/await over callbacks when possible

❌ **DON'T**: Ignore promise rejections or missing error handlers
```javascript
async function fetchUser(id) {
  const response = await getUserFromApi(id); // What if this fails?
  return response.data;
}

getUserFromApi(123).then((data) => process(data)); // No catch!
```

### Function Style

✅ **DO**: Use arrow functions for callbacks, but consider readability
```javascript
// Arrow functions for callbacks
const users = data.map((item) => item.user);
const active = users.filter((u) => u.isActive);

// Named functions for logic-heavy operations
function validateUserEmail(email) {
  // Complex validation logic
  return isValidEmail(email);
}

// Single statement—use implicit return
const double = (x) => x * 2;

// Multiple statements—use block body
const processUser = (user) => {
  user.lastSeen = new Date();
  return sanitizeUser(user);
};
```

❌ **DON'T**: Use function declarations for exports (prefer named exports)
```javascript
function getUserById(id) { /* ... */ } // Less clear for imports
export { getUserById }; // Awkward
```

### Comments & Documentation

✅ **DO**: Document "why", not "what"
```javascript
/**
 * Implements exponential backoff with jitter to prevent thundering herd.
 * Retries up to maxAttempts times with exponential delay.
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Maximum number of retry attempts
 * @returns {Promise} Result of successful fn execution
 */
async function retryWithBackoff(fn, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      // Exponential backoff: 100ms, 400ms, 900ms, etc.
      await sleep(Math.pow(2, attempt) * 100 + Math.random() * 100);
    }
  }
}

// Inline comments for non-obvious logic
const timeout = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

// TODO comments with context
// TODO: Implement caching layer once we profile hot paths
```

❌ **DON'T**: State the obvious
```javascript
// Get the user ID from the request
const userId = req.params.id;

// Loop through users
users.forEach((user) => {
  // ...
});
```

### Error Handling Patterns

✅ **DO**: Create custom error classes for domain-specific errors
```javascript
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends Error {
  constructor(resource, id) {
    super(`${resource} ${id} not found`);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

// Usage
if (!email.includes('@')) {
  throw new ValidationError('Email must contain @');
}
```

### Code Organization

✅ **DO**: Organize files by feature/domain
```
src/
  features/
    users/
      controllers/
        user.controller.js
      services/
        user.service.js
      models/
        user.model.js
      routes/
        user.routes.js
    auth/
      middleware/
        auth.middleware.js
      services/
        auth.service.js
  utils/
  middleware/
  config/
  index.js
```

### Testing Patterns

✅ **DO**: Write tests that are readable and maintainable
```javascript
// Using Jest/Mocha
describe('UserService', () => {
  describe('getUserById', () => {
    it('should return user when exists', async () => {
      const user = await userService.getUserById(123);
      expect(user.id).toBe(123);
    });

    it('should throw NotFoundError when user does not exist', async () => {
      await expect(userService.getUserById(999)).rejects.toThrow(NotFoundError);
    });
  });
});
```

## Best Practices

1. **Avoid console.log in production** — use a structured logger (Winston, Pino, Bunyan)
2. **Use environment variables** — store secrets in `.env` files (never commit)
3. **Return early** — reduce nesting with guard clauses
4. **Immutability** — prefer const, avoid mutating objects when possible
5. **Type hints** — use JSDoc for JavaScript, or migrate to TypeScript
6. **Rate limiting & timeouts** — always apply to external API calls
7. **Graceful shutdown** — handle SIGTERM/SIGINT properly
8. **Logging** — log at appropriate levels (info, warn, error) with context
9. **No magic numbers** — extract to named constants
10. **Module exports** — prefer named exports for easier tree-shaking and testing

## Package.json Scripts

```json
{
  "scripts": {
    "start": "node src/index.js",
    "dev": "tsx watch src/index.js",
    "lint": "eslint src/ --fix",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc --noEmit"
  }
}
```

## Pre-commit Hook (.husky)

Use Husky + lint-staged to auto-format and lint before commits:

```bash
pnpm add -D husky lint-staged
pnpm exec husky init
```

`.husky/pre-commit`:
```bash
pnpm exec lint-staged
```

Add to `package.json`:
```json
{
  "lint-staged": {
    "*.{js,ts}": ["eslint --fix", "prettier --write"],
    "*.json": ["prettier --write"]
  }
}
```

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `nodejs-project-tooling` | Shared tooling configs — ESLint flat config, Prettier, Husky, CI/CD |
| `nodejs-project-boilerplate` | Choosing the right Node.js project archetype |
| `typescript-code-style` | Strict mode, discriminated unions, generics, type guards |
| `project-context` | Capturing project-specific constraints, preferences, and decision log |
