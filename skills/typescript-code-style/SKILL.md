---
name: typescript-code-style
description: TypeScript code style standards covering strict mode configuration, discriminated unions, generics, immutability patterns, type inference, utility types, and testing patterns
---

# TypeScript Code Style Guide

## Overview
This guide establishes code style standards for TypeScript projects. The goal is type safety without ceremony — leverage the type system to catch errors at compile time while keeping code readable.

## Strict Mode Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "isolatedModules": true
  }
}
```

## Type System Fundamentals

### Prefer `unknown` over `any`

✅ **DO**: Use `unknown` when the type is genuinely not known
```typescript
// API responses, deserialized data
function parseJSON(input: string): unknown {
  return JSON.parse(input);
}

// Narrow with type guards
const data = parseJSON('{"name":"test"}');
if (typeof data === 'object' && data !== null && 'name' in data) {
  console.log((data as { name: string }).name);
}
```

❌ **DON'T**: Use `any` — it disables the type checker
```typescript
function parseJSON(input: string): any {
  return JSON.parse(input); // No type safety on return
}

const data = parseJSON('{}');
console.log(data.name.toUpperCase()); // Runtime error, no compile check
```

### Discriminated Unions

✅ **DO**: Model state machines with discriminated unions
```typescript
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

// Usage — TypeScript narrows based on `status`
function renderState<T>(state: AsyncState<T>) {
  switch (state.status) {
    case 'idle': return null;
    case 'loading': return <Spinner />;
    case 'success': return <div>{state.data}</div>; // T is available
    case 'error': return <Error message={state.error} />; // error is available
  }
}

// Result type for operations
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function parseUser(input: unknown): Result<User> {
  // ...
  return { ok: true, value: user };
  // or
  return { ok: false, error: new Error('Invalid') };
}
```

❌ **DON'T**: Use optional fields to model mutually exclusive states
```typescript
interface AsyncState<T> {
  status: string;
  data?: T;
  error?: string;
  // Ambiguous — what does status: 'idle' with data set mean?
}
```

### Generics with Constraints

✅ **DO**: Constrain generics to the minimum required surface
```typescript
// Good: constrained to what you actually need
function getNames<T extends { name: string }>(items: T[]): string[] {
  return items.map(item => item.name);
}

// Even better: use the type parameter inline
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Factory functions
function createStore<T>(initial: T) {
  let state = initial;
  return {
    getState: () => state,
    setState: (next: Partial<T>) => { state = { ...state, ...next }; },
  };
}
```

❌ **DON'T**: Over-constrain or use `any`
```typescript
function getNames(items: any[]): string[] { // Loses all type safety
  return items.map((item: any) => item.name);
}
```

### Immutability Patterns

✅ **DO**: Use `readonly`, `ReadonlyArray`, and `as const`
```typescript
// Readonly properties
interface Config {
  readonly apiUrl: string;
  readonly maxRetries: number;
}

// ReadonlyArray prevents mutation
function processItems(items: readonly string[]): void {
  // items.push('new'); // ❌ Error: push doesn't exist on readonly
  items.map(item => item.toUpperCase()); // ✅ Allowed
}

// as const for literal types and deep readonly
const COLORS = ['red', 'green', 'blue'] as const;
// Type: readonly ["red", "green", "blue"]

const STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
// Values are literal types, not string

// Use const assertions for config objects
export const appConfig = {
  port: 3000,
  host: 'localhost',
  debug: false,
} as const;
```

❌ **DON'T**: Mutate parameters or expose mutable internals
```typescript
function processItems(items: string[]): void {
  items.push('new'); // Side effect — mutates caller's array
}
```

## Type Inference

✅ **DO**: Let TypeScript infer types when obvious
```typescript
const name = 'Alice'; // inferred as string
const count = 42; // inferred as number
const items = ['a', 'b']; // inferred as string[]

const result = items.map(x => x.toUpperCase()); // inferred as string[]
```

✅ **DO**: Annotate return types of functions (public API surface)
```typescript
// Public function — explicit return type acts as documentation & safety net
export async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

// Internal helper — inference is fine
const add = (a: number, b: number) => a + b;
```

❌ **DON'T**: Redundantly annotate obvious types
```typescript
const name: string = 'Alice'; // Unnecessary — 'Alice' is already string
const items: string[] = ['a', 'b']; // Unnecessary
```

## Utility Types

✅ **DO**: Use built-in utility types instead of manual mapping
```typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

// Pick — subset of properties
type UserProfile = Pick<User, 'id' | 'name' | 'email'>;

// Omit — exclude properties
type UserWithoutDates = Omit<User, 'createdAt'>;

// Partial — all optional (useful for updates)
type UpdateUserInput = Partial<Pick<User, 'name' | 'email'>>;

// Record — dictionary type
const userMap: Record<string, User> = {};

// Extract / Exclude — union filtering
type AdminActions = Extract<Role, 'create' | 'delete' | 'view'>;
type NonAdminActions = Exclude<Role, 'admin'>;

// ReturnType — extract return type of a function
type CreateUserResult = ReturnType<typeof createUser>;

// NonNullable — remove null/undefined
type DefinedUser = NonNullable<User | null | undefined>;
```

## Type Imports

✅ **DO**: Use `type` modifier for type-only imports (TypeScript 5+)
```typescript
// Clear: this is a type-only import
import type { User, UserRole } from './types';
import { formatUser } from './utils';

// Also valid for inline-type imports
import { type User, type UserRole, formatUser } from './module';
```

❌ **DON'T**: Mix type and value imports without the type modifier when only types are needed
```typescript
import { User } from './types'; // Emits a runtime import for something that's type-only
```

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| **Types/Interfaces** | PascalCase | `UserProfile`, `ApiResponse` |
| **Type parameters** | Single uppercase or PascalCase | `T`, `K`, `TData` |
| **Enums** | PascalCase (members: PascalCase) | `enum Status { Pending, Approved }` |
| **Const objects** | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| **Functions** | camelCase | `formatDate`, `parseResponse` |

## Patterns

### Branded Types for Domain Safety

```typescript
// Prevent mixing up IDs of different entities
type Brand<T, B> = T & { __brand: B };

type UserId = Brand<string, 'UserId'>;
type PostId = Brand<string, 'PostId'>;

function getUser(id: UserId): User { /* ... */ }
function getPost(id: PostId): Post { /* ... */ }

const uid = 'abc' as UserId;
const pid = 'xyz' as PostId;

getUser(uid); // ✅
getUser(pid); // ❌ Type error — PostId not assignable to UserId
```

### Function Overloads (use sparingly)

```typescript
// Prefer union types over overloads
function parseInput(input: string): string;
function parseInput(input: string[]): string[];
function parseInput(input: string | string[]): string | string[] {
  return Array.isArray(input) ? input.map(x => x.trim()) : input.trim();
}

// Better: use a union parameter
function parseInput(input: string | string[]): string | string[] {
  // Single implementation, narrower return with conditional types if needed
}
```

### Type Guards

```typescript
// Custom type guard
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value
  );
}

// Usage
const data: unknown = await fetchUser();
if (isUser(data)) {
  console.log(data.name); // TypeScript knows this is User
}

// Type guard with branded types
function isUserId(value: string): value is UserId {
  return /^[a-f0-9-]+$/i.test(value);
}
```

## Testing Patterns

✅ **DO**: Use typed mocks and assertions
```typescript
import { vi, describe, it, expect } from 'vitest';

// Typed mock
const mockFetch = vi.fn<[string], Promise<User>>();
mockFetch.mockResolvedValue({ id: '1', name: 'Alice' });

// Type-safe assertions
const result = await fetchUser('1');
expect(result).toMatchObject({ id: '1' });

// Assert types at compile time (type tests)
expectTypeOf(result).toEqualTypeOf<User>();
```

## Best Practices

1. **Strict mode always** — no exceptions for new projects
2. **Prefer `interface` for public API shapes** (better error messages, declaration merging)
3. **Prefer `type` for unions, intersections, and utility transformations**
4. **Never use `any`** — use `unknown` + type guards, or `// eslint-disable-next-line @typescript-eslint/no-explicit-any` with a reason
5. **Model states with discriminated unions** — make illegal states unrepresentable
6. **Use `as const`** for constants, config objects, and enum-like constructs
7. **Prefer `readonly`** for function parameters that shouldn't be mutated
8. **Use `satisfies`** (TS 4.9+) to validate types without widening
9. **Prefer `import type`** for type-only imports
10. **Annotate function return types** at module boundaries
11. **Use branded types** for entity IDs in domain code
12. **Favor `Record<string, T>` over `{ [key: string]: T }`** for dictionary types

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `nodejs-code-style` | Node.js naming, async/await error handling, custom errors, testing patterns |
| `react-code-style` | React component patterns, hooks, forms, TypeScript props |
| `project-context` | Capturing project-specific constraints, preferences, and decision log |
