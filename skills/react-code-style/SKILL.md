---
name: react-code-style
description: React code style standards covering ESLint/Prettier config, component patterns with hooks, TypeScript props, React 19+ features (Actions, use(), useOptimistic, useFormStatus, useTransition), ref as prop, forms, testing, and accessibility
---

# React Code Style Guide

## Overview
This guide establishes code style standards for React projects using **ESLint**, **Prettier**, and **React-specific best practices**. Applies to both JavaScript and TypeScript React codebases.

> **Dependency versions are examples only.** The `package.json`, ESLint, and Prettier snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

## ESLint Configuration

### Recommended Config (`eslint.config.js`)

```javascript
// eslint.config.js
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  jsxA11y.flatConfigs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
  },
);
```

- Flat config is the ESLint 9+ standard — `.eslintrc.*` is deprecated
- For JavaScript-only projects, omit `typescript-eslint` and the TypeScript-specific rules

## Prettier Configuration

Same as Node.js (`printWidth: 100`):

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
  "endOfLine": "lf",
  "jsxSingleQuote": false,
  "bracketSameLine": false
}
```

## Component Structure

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| **Functional components** | PascalCase | `UserCard`, `LoginForm` |
| **Props interface (TS)** | `ComponentName + Props` | `UserCardProps`, `LoginFormProps` |
| **Handlers** | `handle + Action` | `handleClick`, `handleInputChange` |
| **Boolean props** | `is/has/can` prefix | `isLoading`, `hasError`, `canDelete` |
| **Custom hooks** | `use + Name` | `useAuth`, `useFetchUser` |
| **Folders** | kebab-case | `user-card/`, `login-form/` |

### Component File Structure

✅ **DO**: Organize component files consistently
```
src/
  components/
    UserCard/
      UserCard.jsx (or .tsx)
      UserCard.test.jsx
      UserCard.module.css (or .scss)
      useUserCardData.js (custom hook if needed)
      index.js
    LoginForm/
      LoginForm.jsx
      LoginForm.test.jsx
      LoginForm.module.css
  hooks/
    useAuth.js
    useFetchUser.js
  utils/
    formatDate.js
    validateEmail.js
  pages/
    HomePage.jsx
    UserPage.jsx
```

### Component Patterns

#### Functional Components with Hooks

✅ **DO**: Use hooks-based components
```javascript
import { useState, useCallback } from 'react';

function UserCard({ userId, onDelete }) {
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState(null);

  const handleDelete = useCallback(async () => {
    setIsLoading(true);
    try {
      await deleteUser(userId);
      onDelete?.(userId);
    } catch (error) {
      console.error('Failed to delete user:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, onDelete]);

  return (
    <div className="user-card">
      <h3>{user?.name}</h3>
      <button onClick={handleDelete} disabled={isLoading}>
        {isLoading ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  );
}

export default UserCard;
```

#### With TypeScript

✅ **DO**: Define props types explicitly
```typescript
type UserCardProps = {
  userId: string;
  onDelete?: (id: string) => void;
  className?: string;
};

type User = {
  id: string;
  name: string;
  email: string;
};

function UserCard({ userId, onDelete, className }: UserCardProps): JSX.Element {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);

  // Component code...

  return <div className={className}>{/* ... */}</div>;
}

export default UserCard;
```

### Hooks Usage

✅ **DO**: Extract custom hooks for reusable logic
```javascript
// hooks/useUser.js
import { useState, useEffect } from 'react';

function useUser(userId) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) return;

    async function loadUser() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchUser(userId);
        setUser(data);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [userId]);

  return { user, loading, error };
}

export default useUser;
```

❌ **DON'T**: Break rules of hooks
```javascript
// ❌ Conditional hook calls
if (condition) {
  useEffect(() => {});
}

// ❌ Hook called in a loop
items.forEach(() => useEffect(...));

// ❌ Missing dependency
useEffect(() => {
  console.log(userId); // userId used but not in deps
}, []);
```

### Props & State Management

✅ **DO**: Destructure props, keep props focused
```javascript
function UserProfile({ user, onUpdate, isEditing }) {
  const [formData, setFormData] = useState(user);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div>
      {isEditing ? (
        <form>
          <input
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
          />
        </form>
      ) : (
        <p>{user.name}</p>
      )}
    </div>
  );
}
```

✅ **DO**: Use prop drilling minimally—consider Context for global state
```javascript
// context/AuthContext.js
import { createContext, useContext } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  return (
    <AuthContext value={{ user, setUser }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// In a component
function Dashboard() {
  const { user } = useAuth();
  return <h1>Welcome, {user.name}</h1>;
}
```

### React 19: Context Improvements

#### Cleaner Provider Syntax

✅ **DO** (React 19+): Use `<Context>` directly as a provider

```javascript
import { createContext, useState } from 'react';

const ThemeContext = createContext('light');

function App({ children }) {
  const [theme, setTheme] = useState('light');

  return (
    // No more <ThemeContext.Provider>, use Context directly
    <ThemeContext value={{ theme, setTheme }}>
      {children}
    </ThemeContext>
  );
}
```

#### Conditional Context Reading with `use()`

✅ **DO** (React 19+): Use `use()` to read context conditionally

In React 19, the `use()` API allows reading context after early returns—**still requires a provider in the tree**, but with more flexible usage:

```javascript
import { use } from 'react';
import ThemeContext from './ThemeContext';

function Heading({ children }) {
  // Early return without breaking context usage
  if (!children) {
    return null;
  }

  // `use()` works here after early return
  // (useContext would throw "rules of hooks" error)
  const { theme, setTheme } = use(ThemeContext);

  return (
    <h1 style={{ color: theme === 'dark' ? '#fff' : '#000' }}>
      {children}
    </h1>
  );
}

function Card() {
  const { theme } = use(ThemeContext);

  return (
    <div style={{ background: theme === 'dark' ? '#333' : '#f0f0f0' }}>
      Card content
    </div>
  );
}
```

#### Full React 19 Context Pattern

✅ **DO**: Modern context setup combining both improvements

```javascript
// context/ThemeContext.js
import { createContext, useState } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light');

  const toggle = () => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext value={{ theme, toggle }}>
      {children}
    </ThemeContext>
  );
}

export { ThemeContext };

// In app.jsx
import { ThemeProvider } from './context/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <Navbar />
      <MainContent />
    </ThemeProvider>
  );
}

// In any component
import { use } from 'react';
import { ThemeContext } from './context/ThemeContext';

function Button({ label }) {
  const { theme, toggle } = use(ThemeContext);

  return (
    <button
      onClick={toggle}
      style={{
        background: theme === 'dark' ? '#333' : '#fff',
        color: theme === 'dark' ? '#fff' : '#000',
      }}
    >
      {label}
    </button>
  );
}
```

**Key Points**:
- ✅ Provider still required at root
- ✅ `<Context>` is cleaner syntax than `<Context.Provider>`
- ✅ `use(Context)` works with early returns (unlike `useContext`)
- ✅ `use()` can also read Promises and Suspense-compatible resources

### Event Handlers

✅ **DO**: Use semantic naming and handle events properly
```javascript
function SearchForm({ onSearch }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query);
    }
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        placeholder="Search..."
      />
      <button type="submit">Search</button>
    </form>
  );
}
```

### Using `use()` API for Flexible Data Reading (React 19+)

✅ **DO**: Use `use()` to read promises and context with early returns

```javascript
import { use } from 'react';

// Read promises (Suspense-compatible)
function CommentSection({ commentsPromise }) {
  // Early return works with use()
  if (!commentsPromise) {
    return <p>No comments</p>;
  }
  
  // use() unwraps the promise
  const comments = use(commentsPromise);
  
  return comments.map((c) => <Comment key={c.id} comment={c} />);
}

// Read context conditionally
function Card({ children }) {
  if (!children) return null;
  
  // use() works after early return (useContext would fail)
  const { theme } = use(ThemeContext);
  
  return (
    <div style={{ background: theme === 'dark' ? '#333' : '#fff' }}>
      {children}
    </div>
  );
}
```

### ref as a Prop (React 19+)

✅ **DO** (React 19+): Accept ref directly as a prop—no more forwardRef needed

```javascript
// Before: needed forwardRef wrapper
// const TextInput = forwardRef(({ placeholder }, ref) => (
//   <input ref={ref} placeholder={placeholder} />
// ));

// After: much cleaner
function TextInput({ placeholder, ref }) {
  return <input ref={ref} placeholder={placeholder} />;
}

// Usage
function Form() {
  const inputRef = useRef();
  
  return (
    <>
      <TextInput ref={inputRef} placeholder="Type here" />
      <button onClick={() => inputRef.current?.focus()}>
        Focus
      </button>
    </>
  );
}
```

### Ref Cleanup Functions (React 19+)

✅ **DO**: Return cleanup function from ref callback

```javascript
function VideoPlayer({ src }) {
  return (
    <video
      ref={(element) => {
        if (!element) return;
        
        // Play video when element is added
        element.play();
        
        // Return cleanup function
        return () => {
          // Cleanup when element is removed
          element.pause();
        };
      }}
      src={src}
    />
  );
}
```

❌ **DON'T**: Inline functions in JSX (except simple arrows)
```javascript
// ❌ Recreates function on every render
<button onClick={() => handleDelete(item.id)}>Delete</button>

// ✅ Use useCallback if needed
const handleDelete = useCallback((id) => {
  deleteItem(id);
}, []);
```

### Conditional Rendering

✅ **DO**: Use clear, readable patterns
```javascript
// Simple condition
{isLoading && <Spinner />}

// If-else with ternary
{isLoading ? <Spinner /> : <Content />}

// Multiple conditions
{isLoading && <Spinner />}
{error && <ErrorMessage error={error} />}
{!isLoading && !error && <Content />}

// With early return in component logic
if (!user) return <p>Loading user...</p>;
return <UserProfile user={user} />;
```

❌ **DON'T**: Use inline conditional logic that's hard to read
```javascript
{isLoading || error ? <Error /> : isValid && user ? <Valid /> : <Loading />}
```

### Keys in Lists

✅ **DO**: Use stable, unique identifiers
```javascript
function UserList({ users }) {
  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

❌ **DON'T**: Use array index as key
```javascript
// ❌ Keys are unreliable if list changes
{users.map((user, index) => (
  <li key={index}>{user.name}</li>
))}
```

### Performance Optimization

✅ **DO**: Memoize components that receive expensive props
```javascript
import { memo, useCallback } from 'react';

const UserCard = memo(function UserCard({ user, onDelete }) {
  const handleDelete = useCallback(() => {
    onDelete(user.id);
  }, [onDelete, user.id]);

  return (
    <div>
      <h3>{user.name}</h3>
      <button onClick={handleDelete}>Delete</button>
    </div>
  );
});

function UserList({ users, onDelete }) {
  return (
    <ul>
      {users.map((user) => (
        <UserCard key={user.id} user={user} onDelete={onDelete} />
      ))}
    </ul>
  );
}
```

✅ **DO**: Use useMemo for expensive computations
```javascript
import { useMemo } from 'react';

function Dashboard({ users }) {
  const activeUsers = useMemo(
    () => users.filter((u) => u.isActive),
    [users]
  );

  const statistics = useMemo(
    () => calculateStats(activeUsers),
    [activeUsers]
  );

  return <div>{/* render with statistics */}</div>;
}
```

## Forms

### Modern Pattern: Server Actions (React 19+)

✅ **DO** (React 19+): Use form Actions for automatic state handling and validation

```javascript
import { useActionState } from 'react';
import { SubmitButton } from './SubmitButton';

function ChangeNameForm({ currentName, onNameChange }) {
  const [error, submitAction, isPending] = useActionState(
    async (previousState, formData) => {
      const newName = formData.get('name');

      // Validate on server
      if (!newName || newName.length < 2) {
        return 'Name must be at least 2 characters';
      }

      try {
        await updateUserName(newName);
        onNameChange(newName);
        return null; // Success, error is null
      } catch (err) {
        return 'Failed to update name. Try again.';
      }
    },
    null // initial state
  );

  return (
    <form action={submitAction}>
      <input
        type="text"
        name="name"
        defaultValue={currentName}
        required
        disabled={isPending}
      />
      <SubmitButton label="Update Name" />
      {error && <p className="error">{error}</p>}
    </form>
  );
}
```

**Benefits**:
- ✅ Form auto-resets on success
- ✅ Loading state handled automatically
- ✅ Error handling built-in
- ✅ No extra state management needed

### Classic Pattern: Controlled Components

✅ **DO**: Use controlled inputs when you need real-time validation/feedback

```javascript
function LoginForm({ onSubmit }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validate({ email, password });
    if (Object.keys(newErrors).length === 0) {
      onSubmit({ email, password });
      setEmail('');
      setPassword('');
    } else {
      setErrors(newErrors);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email"
      />
      {errors.email && <span className="error">{errors.email}</span>}
      {/* password field */}
      <button type="submit">Login</button>
    </form>
  );
}
```

### useFormStatus for Design Components

✅ **DO** (React 19+): Use `useFormStatus` in form components without prop drilling

```javascript
import { useFormStatus } from 'react-dom';

// Reusable submit button that reads form status automatically
function SubmitButton({ label = 'Submit' }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Processing...' : label}
    </button>
  );
}

// In your form
function ContactForm() {
  const [, submitAction] = useActionState(handleSubmit, null);

  return (
    <form action={submitAction}>
      <input name="name" required />
      <textarea name="message" required />
      <SubmitButton label="Send" /> {/* No props needed! */}
    </form>
  );
}
```

### useOptimistic for Instant UI Feedback

✅ **DO** (React 19+): Show optimistic updates while mutations happen

```javascript
import { useOptimistic } from 'react';
import { useActionState } from 'react';

function TodoItem({ todo }) {
  const [optimisticTodo, setOptimisticTodo] = useOptimistic(todo);
  
  const [, submitAction] = useActionState(async (formData) => {
    const completed = formData.get('completed') === 'true';
    
    // Instantly update UI
    setOptimisticTodo({ ...optimisticTodo, completed });
    
    // Then sync with server
    await updateTodo(optimisticTodo.id, { completed });
  });

  return (
    <form action={submitAction}>
      <input type="hidden" name="completed" value={!optimisticTodo.completed} />
      <input
        type="checkbox"
        checked={optimisticTodo.completed}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      <span style={{ textDecoration: optimisticTodo.completed ? 'line-through' : 'none' }}>
        {optimisticTodo.text}
      </span>
    </form>
  );
}
```

### useTransition for Concurrent Updates

✅ **DO** (React 19+): Use `useTransition` for non-blocking state updates

```javascript
import { useTransition, useState } from 'react';

function SearchUsers() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isPending, startTransition] = useTransition();

  const handleSearch = (e) => {
    setQuery(e.target.value);
    
    // Non-blocking update—UI stays responsive
    startTransition(async () => {
      const data = await searchAPI(e.target.value);
      setResults(data);
    });
  };

  return (
    <div>
      <input value={query} onChange={handleSearch} placeholder="Search..." />
      {isPending && <p>Loading...</p>}
      <ul>
        {results.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

### Form Libraries

For **complex validation logic**, still use **React Hook Form** with Actions:

```javascript
import { useForm } from 'react-hook-form';
import { useActionState } from 'react';

function ComplexForm() {
  const { register, handleSubmit, formState: { errors } } = useForm();
  const [, submitAction] = useActionState(handleSubmit(async (data) => {
    await submitData(data);
  }), null);

  return (
    <form action={submitAction}>
      <input {...register('email', { required: true, pattern: /.+@.+/ })} />
      {errors.email && <span>{errors.email.message}</span>}
      <button type="submit">Submit</button>
    </form>
  );
}
```

## Testing

### Component Testing with Jest/React Testing Library

✅ **DO**: Test user behavior, not implementation
```javascript
import { render, screen, fireEvent } from '@testing-library/react';
import UserCard from './UserCard';

describe('UserCard', () => {
  it('should render user name', () => {
    render(<UserCard user={{ id: 1, name: 'John' }} />);
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  it('should call onDelete when delete button clicked', async () => {
    const handleDelete = jest.fn();
    render(<UserCard user={{ id: 1, name: 'John' }} onDelete={handleDelete} />);
    
    fireEvent.click(screen.getByText('Delete'));
    expect(handleDelete).toHaveBeenCalledWith(1);
  });

  it('should show loading state while deleting', () => {
    render(<UserCard user={{ id: 1 }} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Deleting...')).toBeInTheDocument();
  });
});
```

## Accessibility (a11y)

✅ **DO**: Build accessible components
```javascript
function SearchForm({ onSearch }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSearch(); }}>
      <label htmlFor="search-input">Search:</label>
      <input
        id="search-input"
        type="text"
        aria-label="Search users"
        placeholder="Enter search term"
      />
      <button type="submit">Search</button>
    </form>
  );
}
```

**Key rules**:
- All form inputs have associated `<label>` tags
- Use semantic HTML (`<button>`, `<nav>`, `<main>`)
- Provide `alt` text for images
- Use ARIA attributes when semantic HTML isn't enough

## React 19+ Server Components (Framework-Dependent)

If using Next.js 13+ or similar framework with Server Components:

✅ **DO**: Use `'use server'` directive for server functions

```javascript
// app/actions/user.js
'use server';

export async function updateUserName(userId, newName) {
  // This runs on the server only
  const user = await db.users.update(userId, { name: newName });
  revalidatePath('/profile');
  return user;
}

// In a Client Component
'use client';

import { updateUserName } from './actions/user';
import { useActionState } from 'react';

function UserProfile() {
  const [error, submitAction] = useActionState(
    async (prev, formData) => {
      const result = await updateUserName(
        formData.get('userId'),
        formData.get('name')
      );
      return result.error || null;
    },
    null
  );

  return (
    <form action={submitAction}>
      <input type="hidden" name="userId" value="123" />
      <input type="text" name="name" required />
      <button type="submit">Update</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
```

## Best Practices (React 19+)

1. **Use Actions for mutations** — prefer `useActionState` over manual state management for forms
2. **Leverage `use()` for flexibility** — read context/promises conditionally, after early returns
3. **Use `useOptimistic` for instant feedback** — keep UI responsive during network requests
4. **Forget `forwardRef`** — components now accept `ref` as a prop directly
5. **Prefer `useFormStatus` over prop drilling** — read form state in nested components automatically
6. **Use `useTransition` for concurrent updates** — keep UI responsive during heavy computations
7. **One component per file** (or grouped logically in a folder)
8. **Keep props focused** — avoid passing everything; consider composition or Context
9. **Avoid prop drilling** — use Context API or state management for deeply nested data
10. **Don't mutate state** — use immutable updates (`setUser({ ...user, name: 'New' })`)
11. **Handle loading and error states** — always show feedback to users
12. **Extract complex logic to custom hooks** — reuse across components
13. **Memoize expensive computations** — use `useMemo`, `useCallback` appropriately (but less often now with Actions)
14. **Dependency arrays matter** — never ignore `exhaustive-deps` warnings
15. **Test behavior, not implementation** — focus on what users see/interact with
16. **Keep components small** — if a component is >300 lines, split it

## Package.json Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/ --fix",
    "format": "prettier --write .",
    "type-check": "tsc --noEmit"
  }
}
```

## Pre-commit Hook

Same as Node.js (use Husky + lint-staged):

```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.json": ["prettier --write"]
  }
}
```

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `react-code-guidelines` | React project architecture, state management, data fetching, performance |
| `typescript-code-style` | Strict mode, discriminated unions, generics, type guards |
| `nodejs-code-style` | Node.js naming, async/await error handling, custom errors |
| `project-context` | Capturing project-specific constraints, preferences, and decision log |
