---
name: react-code-guidelines
description: React project architecture guidelines covering web standards (Fetch API, Zustand, HTTP-only cookies), tRPC/Zod data fetching, Tailwind/Shadcn UI, auth patterns, TypeScript strict mode, testing standards, CI/CD, performance optimization, and error monitoring
---

# React Code Guidelines

## Overview
This guide establishes comprehensive guidelines for writing clean, maintainable, and efficient React code. It is complementary to the [React Code Style Guide](react-code-style.md) and focuses on architectural patterns, tooling, and best practices.

**Core Principle**: Use web standards (Fetch API, native APIs) and minimal dependencies. Zustand for state management, HTTP-only cookies for auth.

> **Dependency versions and action versions are examples only.** The `package.json`, Vite, GitHub Actions, and install snippets in this skill illustrate structure and package choices. When creating a project, resolve and use the latest stable version of each package or action unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

---

## Project Scaffolding & Setup

### Stack Foundation
- **Framework**: React 19+ (with TypeScript)
- **Build Tool**: Vite (fastest dev server & build, optimal code splitting)
- **Language**: TypeScript (strict mode enforced)
- **Styling**: Tailwind CSS + PostCSS
- **UI Components**: Shadcn UI (accessible, customizable, headless)
- **Package Manager**: pnpm (faster, stricter dependency management than npm/yarn)
- **HTTP Client**: Native Fetch API (web standard)
- **State Management**: React Context API + Zustand (minimal deps)
- **Validation**: Zod (schema validation for API + forms)
- **Data Fetching**: TanStack Query (optional, for complex scenarios)

**Philosophy**: Prefer web standards (Fetch, native APIs) over third-party libraries when possible. Only add dependencies for features not available natively.

### Initial Project Setup
```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
pnpm install
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
pnpm add shadcn-ui zod

# Optional: for complex data fetching scenarios
pnpm add @tanstack/react-query
pnpm add zustand  # for complex state management
```

### Vite Configuration Best Practices
```javascript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'ES2020',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
        },
      },
    },
  },
});
```

---

## Web Standards & APIs

### Prefer Native Web APIs
Whenever possible, use native web standards instead of third-party libraries. This reduces bundle size, dependencies, and complexity.

#### Storage & State
- **Zustand** (✅) → For all client-side state (global, persistent, auth)
- **React State** (✅) → For component-local state
- **Context API** (✅) → For sharing state without Zustand
- **IndexedDB** (✅) → For large datasets, offline-first apps
- **HTTP-only Cookies** (✅) → For secure token handling (set by server)
- ❌ Avoid: localStorage, sessionStorage (XSS vulnerability, manual sync issues)
- ❌ Avoid: Redux, Mobx, etc. (Zustand is simpler)

See the **State Management** section for Zustand examples.

#### HTTP Networking & Auth
- **Fetch API** (✅) → Instead of axios, request, http-client
- **HTTP-only Cookies** (✅) → For secure token handling (set by server, auto-sent)
- **AbortController** (✅) → For canceling requests
- ❌ Avoid: axios, superagent (unnecessary overhead)
- ❌ Avoid: Storing tokens in localStorage/sessionStorage (XSS vulnerable)

```typescript
// Server sets a secure HTTP-only cookie; the client sends it automatically
const response = await fetch('/api/protected', {
  credentials: 'include',
});

// User state is managed in Zustand — never store tokens in localStorage
// localStorage.setItem('token', authToken); // ❌ VULNERABLE TO XSS
```

See the **Data Fetching & API Integration** section for a complete typed Fetch client.

#### DOM & Events
- **Event API** (✅) → Standard DOM events
- **Intersection Observer** (✅) → Lazy loading, infinite scroll
- **Resize Observer** (✅) → Component dimension tracking
- **Mutation Observer** (✅) → DOM changes tracking
- ❌ Avoid: jQuery-like libraries for DOM manipulation

```typescript
// Lazy loading with Intersection Observer
function useLazyImage(ref: React.RefObject<HTMLImageElement>) {
  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && ref.current?.dataset.src) {
        ref.current.src = ref.current.dataset.src;
        observer.unobserve(ref.current);
      }
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
}
```

#### Animations
- **CSS Animations/Transitions** (✅) → For most cases (better performance)
- **requestAnimationFrame** (✅) → Custom animations
- **Web Animations API** (✅) → Programmatic control
- ❌ Avoid: Framer Motion, React Spring, GSAP unless truly necessary

```css
/* styles.css */
@keyframes slideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.slideIn { animation: slideIn 0.3s ease-out; }
```

#### Validation & Serialization
- **Zod** (✅) → Schema validation, type-safe parsing, API response validation
- **HTML5 Validation** (✅) → Built-in form validation attributes
- **FormData API** (✅) → Form handling (native)
- **JSON** (✅) → Serialization (native)
- ❌ Avoid: Yup, Joi (Zod is simpler and more powerful)

API response validation with Zod is covered in **Data Fetching & API Integration**. For form validation:

```typescript
import { z } from 'zod';

const LoginFormSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be 8+ characters'),
});

function LoginForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData);

    const result = LoginFormSchema.safeParse(data);
    if (!result.success) {
      setErrors(result.error.flatten().fieldErrors);
      return;
    }
    submitLogin(result.data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" required />
      {errors.email && <span>{errors.email}</span>}
      <input name="password" type="password" required />
      {errors.password && <span>{errors.password}</span>}
      <button type="submit">Login</button>
    </form>
  );
}
```

---

## Folder Structure (Feature-Based)
```
src/
  app/
    layout.tsx           # Root layout with providers
    page.tsx             # Home page
  features/
    auth/
      components/
        LoginForm.tsx
        SignupForm.tsx
      hooks/
        useAuth.ts
        useSession.ts
      services/
        auth.service.ts
      types/
        auth.types.ts
    dashboard/
      components/
        Dashboard.tsx
        UserProfile.tsx
      pages/
        DashboardPage.tsx
  shared/
    components/          # Reusable UI components
      Button/
        Button.tsx
        Button.stories.tsx
      Card/
      Dialog/
      ...
    hooks/               # Shared custom hooks
      useFetch.ts
    utils/               # Utility functions
      formatters.ts
      validators.ts
    types/               # Global TypeScript types
      common.types.ts
    context/             # Shared context providers
      ThemeContext.tsx
      NotificationContext.tsx
  services/              # API & external service integrations
    api/
      client.ts          # API client setup
      endpoints.ts
  styles/
    globals.css          # Tailwind + custom globals
```

## File Naming Conventions
| Type | Pattern | Example |
|------|---------|---------|
| **Components** | PascalCase | `UserCard.tsx` |
| **Pages** | PascalCase with "Page" suffix | `DashboardPage.tsx` |
| **Hooks** | camelCase with "use" prefix | `useFetchUser.ts` |
| **Services** | camelCase with ".service" suffix | `auth.service.ts` |
| **Types** | PascalCase with ".types" suffix | `user.types.ts` |
| **Utils** | camelCase | `formatDate.ts` |
| **Tests** | Same as source with ".test" suffix | `Button.test.tsx` |
| **Stories** | Same as source with ".stories" suffix | `Button.stories.tsx` |

---

## State Management

### Decision Tree
```
Simple local state → useState
Form state with validation → useActionState + Zod (safeParse on FormData)
Cross-component state (< 3 levels deep) → Context + useReducer
Global app state (auth, theme, notifications) → Zustand
Complex async state (data fetching) → TanStack Query
Temporal/undo-redo state → Zustand with middleware
```

### Context API Pattern (React 19+)
```typescript
// context/AuthContext.tsx
import { createContext, useReducer } from 'react';

type AuthState = { user: User | null; isLoading: boolean };
type AuthAction = { type: 'LOGIN'; payload: User } | { type: 'LOGOUT' };

const AuthContext = createContext<{ state: AuthState; dispatch: React.Dispatch<AuthAction> } | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  
  return (
    <AuthContext value={{ state, dispatch }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
```

### For Complex State: Zustand
Zustand is lightweight (2KB) and perfect for both transient and persistent state:

```typescript
// store/userStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserStore {
  users: User[];
  selectedUserId: string | null;
  isLoading: boolean;
  fetchUsers: () => Promise<void>;
  selectUser: (id: string) => void;
  addUser: (user: User) => void;
}

export const useUserStore = create<UserStore>(
  persist(
    (set) => ({
      users: [],
      selectedUserId: null,
      isLoading: false,
      
      fetchUsers: async () => {
        set({ isLoading: true });
        try {
          const users = await apiClient.get<User[]>('/users');
          set({ users });
        } finally {
          set({ isLoading: false });
        }
      },
      
      selectUser: (id) => set({ selectedUserId: id }),
      addUser: (user) => set((state) => ({ users: [...state.users, user] })),
    }),
    {
      name: 'user-store', // Key name in browser storage
      version: 1,
      // Only persist specific fields (skip sensitive data)
      partialize: (state) => ({
        users: state.users,
        selectedUserId: state.selectedUserId,
        // Don't persist isLoading (it's transient)
      }),
    }
  )
);

// Usage
function UserList() {
  const { users, isLoading, fetchUsers } = useUserStore();

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  if (isLoading) return <Spinner />;
  return <div>{/* render users */}</div>;
}
```

**Zustand with persist middleware**:
- Automatically saves to browser storage (default: localStorage)
- Automatically rehydrates on page load
- Type-safe
- Fine-grained control over what persists
- Auto-syncs across tabs

### For Data Fetching: TanStack Query (React Query)
```typescript
import { useQuery, useMutation } from '@tanstack/react-query';

function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.getUser(userId),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { mutate: updateUser } = useMutation({
    mutationFn: (data) => api.updateUser(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBoundary error={error} />;
  
  return <div>{/* render user */}</div>;
}
```

---

## Data Fetching & API Integration

### Choosing an API Strategy

| Scenario | Recommendation |
|---|---|
| Full-stack TypeScript (you own the backend) | **tRPC** — end-to-end type safety, no manual schemas |
| External / third-party REST API | **Fetch API + Zod** — validate response at the boundary |
| Mixed (internal + external) | tRPC for internal routes, Fetch + Zod for external |

---

### Option A: tRPC (Full-Stack TypeScript)

Use tRPC when you control both the React frontend and a Node.js backend (Express, Fastify, Hono, etc.). Types flow automatically from server router to client — no duplicated Zod schemas for responses.

```bash
# Server
pnpm add @trpc/server zod

# Client
pnpm add @trpc/client @trpc/react-query @tanstack/react-query
```

#### Server Setup
```typescript
// server/trpc.ts
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

// server/routers/user.ts
export const userRouter = router({
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.user.findUnique({ where: { id: input.id } });
      // Return type is inferred — no manual schema needed
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      email: z.string().email(),
    }))
    .mutation(async ({ input }) => {
      return db.user.update({ where: { id: input.id }, data: input });
    }),
});

// server/router.ts
export const appRouter = router({ user: userRouter });
export type AppRouter = typeof appRouter; // Export for client
```

#### Client Setup
```typescript
// lib/trpc.ts
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/server/router';

export const trpc = createTRPCReact<AppRouter>();

// App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from '@/lib/trpc';

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      fetch: (url, options) => fetch(url, { ...options, credentials: 'include' }),
    }),
  ],
});

export function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* app */}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

#### Usage in Components
```typescript
function UserProfile({ userId }: { userId: string }) {
  // Fully typed — no manual schema, type inferred from server router
  const { data: user, isLoading } = trpc.user.getById.useQuery({ id: userId });

  const { mutate: updateUser } = trpc.user.update.useMutation({
    onSuccess: () => trpc.useUtils().user.getById.invalidate({ id: userId }),
  });

  if (isLoading) return <Spinner />;
  return <div>{user?.name}</div>;
}
```

**Key Points**:
- ✅ Single source of truth: types live on the server router
- ✅ Zod used for **input validation** on procedures (server-side)
- ✅ No duplicated response schemas — the TypeScript return type is the contract
- ✅ Built on TanStack Query — familiar caching, refetching, optimistic updates
- ✅ Auth cookies work via custom `fetch` override in `httpBatchLink`

---

### Option B: Fetch API + Zod (External / Third-Party APIs)

Use this when you consume an API you don't control. Zod validates the response at the boundary to ensure runtime type safety.

### API Client Setup (Fetch API - Web Standard)
```typescript
// services/api/client.ts
import { z, ZodSchema } from 'zod';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

interface FetchOptions extends RequestInit {
  data?: unknown;
  schema?: ZodSchema; // Optional response validation
}

class APIClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private async handleResponse<T>(response: Response, schema?: ZodSchema): Promise<T> {
    if (!response.ok) {
      if (response.status === 401) {
        // Handle unauthorized—redirect to login
        window.location.href = '/login';
      }
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    const json = await response.json();
    
    // Validate response with Zod if schema provided
    if (schema) {
      const result = schema.safeParse(json);
      if (!result.success) {
        console.error('Invalid API response:', result.error.flatten());
        throw new Error('Invalid API response structure');
      }
      return result.data as T;
    }
    
    return json as T;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Auth token is sent automatically in HTTP-only cookie
    // No need to manually add it here
    // (Server sets: Set-Cookie: token=xyz; HttpOnly; Secure; SameSite=Strict)

    return headers;
  }

  async request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const { data, schema, ...fetchOptions } = options;
    const url = `${this.baseURL}${endpoint}`;

    const config: RequestInit = {
      ...fetchOptions,
      credentials: 'include', // Include HTTP-only cookies
      headers: {
        ...this.getHeaders(),
        ...(fetchOptions.headers || {}),
      },
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    const response = await fetch(url, config);
    return this.handleResponse<T>(response, schema);
  }

  get<T>(endpoint: string, schema?: ZodSchema) {
    return this.request<T>(endpoint, { method: 'GET', schema });
  }

  post<T>(endpoint: string, data: unknown, schema?: ZodSchema) {
    return this.request<T>(endpoint, { method: 'POST', data, schema });
  }

  patch<T>(endpoint: string, data: unknown, schema?: ZodSchema) {
    return this.request<T>(endpoint, { method: 'PATCH', data, schema });
  }

  delete<T>(endpoint: string, schema?: ZodSchema) {
    return this.request<T>(endpoint, { method: 'DELETE', schema });
  }
}

export const apiClient = new APIClient(API_BASE_URL);
```

### Typed API Endpoints with Zod Validation
```typescript
// services/api/schemas.ts
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

export const PostSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().min(1),
  authorId: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export type Post = z.infer<typeof PostSchema>;

// services/api/endpoints.ts
import { apiClient } from './client';
import { UserSchema, PostSchema, type User, type Post } from './schemas';

export const userAPI = {
  getUser: (id: string) => 
    apiClient.get<User>(`/users/${id}`, UserSchema),
  
  updateUser: (id: string, data: Partial<User>) =>
    apiClient.patch<User>(`/users/${id}`, data, UserSchema),
  
  deleteUser: (id: string) => 
    apiClient.delete(`/users/${id}`),
};

export const postAPI = {
  getPosts: () => 
    apiClient.get<Post[]>('/posts', z.array(PostSchema)),
  
  createPost: (data: Omit<Post, 'id' | 'createdAt'>) =>
    apiClient.post<Post>('/posts', data, PostSchema),
};
```

**Benefits**:
- ✅ Type-safe API responses (TypeScript + runtime validation)
- ✅ Invalid responses caught immediately
- ✅ Single source of truth for schemas
- ✅ Better error messages on validation failure

### Error Handling Pattern
```typescript
class APIError extends Error {
  constructor(
    public statusCode: number,
    public message: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export async function safeAPI<T>(fn: () => Promise<T>): Promise<[T | null, APIError | null]> {
  try {
    const data = await fn();
    return [data, null];
  } catch (error) {
    const isAPIError = error instanceof Error && error.message.startsWith('API Error');
    const statusCode = isAPIError ? parseInt(error.message.match(/\d+/)?.[0] || '500') : 500;
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    const apiError = new APIError(statusCode, message);
    return [null, apiError];
  }
}

// Usage
const [user, error] = await safeAPI(() => userAPI.getUser('123'));
if (error) {
  console.error(`Failed with status ${error.statusCode}: ${error.message}`);
}
```

---

## Testing Standards

### Test Types & Coverage Goals
| Type | Tool | Coverage | When |
|------|------|----------|------|
| **Unit Tests** | Vitest + Testing Library | 80% | For utilities, hooks, business logic |
| **Integration Tests** | Vitest + Testing Library | 60% | Component interactions, API calls |
| **E2E Tests** | Playwright | 40% | Critical user workflows |
| **Visual Regression** | Chromatic/Playwright | High-risk components | Design system, complex UI |

### Unit Test Example
```typescript
// Button.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('should render with label', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('should call onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('should be disabled when disabled prop is true', () => {
    render(<Button disabled>Click</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

### Integration Test Example
```typescript
// LoginForm.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
import * as authAPI from '@/services/api/auth.service';

vi.mock('@/services/api/auth.service');

describe('LoginForm', () => {
  it('should submit form with email and password', async () => {
    vi.mocked(authAPI.login).mockResolvedValue({ token: 'abc123' });
    
    render(<LoginForm onSuccess={() => {}} />);
    
    await userEvent.type(screen.getByLabelText('Email'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    
    await waitFor(() => {
      expect(authAPI.login).toHaveBeenCalledWith('user@example.com', 'password123');
    });
  });
});
```

### Vitest Setup
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.ts',
        '**/*.stories.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

---

## TypeScript Standards

### Strict Mode (Required)
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### Type Definition Best Practices
```typescript
// ✅ DO: Define types clearly
type User = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

type UserRole = 'admin' | 'user' | 'guest';

type AsyncState<T> = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

// ✅ DO: Use discriminated unions
type Result<T> = { success: true; data: T } | { success: false; error: string };

// ❌ DON'T: Use generic `any`
const getData = async (id: any) => { /* ... */ }; // ❌

// ✅ DO: Use generics with constraints
const getData = async <T extends { id: string }>(item: T): Promise<T> => { /* ... */ };

// ❌ DON'T: Over-constrain types
const formatData = (data: Record<string, any>) => { /* ... */ }; // Too loose

// ✅ DO: Be specific
const formatData = <T extends { name: string }>(data: T) => { /* ... */ };
```

---

## Styling with Tailwind CSS & Shadcn UI

### Tailwind Best Practices
```tsx
// ✅ DO: Use Tailwind utilities directly
function Card({ title, children }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

// ✅ DO: Use @apply for reusable patterns in components
const buttonClasses = 'inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50';

// ✅ DO: Use CSS modules for component-scoped styles when needed
// Card.module.css
.cardContainer { @apply rounded-lg border border-gray-200 bg-white p-6 shadow-sm; }

// ❌ DON'T: Mix inline styles with Tailwind
<div style={{ color: 'red' }} className="text-lg">...</div>

// ✅ DO: Use Tailwind for all styling
<div className="text-red-600 text-lg">...</div>
```

### Shadcn UI Integration
```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';

function MyComponent() {
  return (
    <Dialog>
      <Button>Open Dialog</Button>
      <DialogContent>
        <Input placeholder="Enter text..." />
      </DialogContent>
    </Dialog>
  );
}
```

### Dark Mode Support
```tsx
// tailwind.config.js
module.exports = {
  darkMode: 'class', // or 'media'
  // ...
};

// Use in components
<div className="bg-white text-black dark:bg-slate-900 dark:text-white">
  Content
</div>
```

### Responsive Design Breakpoints
```tsx
// Mobile-first approach
<div className="text-sm md:text-base lg:text-lg">
  Text scales: small on mobile, medium on tablet, large on desktop
</div>

// Standard Tailwind breakpoints
// sm: 640px, md: 768px, lg: 1024px, xl: 1280px, 2xl: 1536px
```

---

## Error Handling & Monitoring

### Error Boundaries
```typescript
// components/ErrorBoundary.tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error) => React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, { hasError: boolean; error: Error | null }> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught:', error, errorInfo);
    // Send to error tracking service (Sentry, etc.)
    logErrorToService(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback?.(this.state.error!) || (
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
              <p className="text-gray-600 mt-2">{this.state.error?.message}</p>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
```

### Error Logging Integration (Sentry)
```typescript
// services/errorTracking.ts
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
});

export const captureException = (error: Error, context?: Record<string, any>) => {
  Sentry.captureException(error, { tags: context });
};

export const captureMessage = (message: string, level: 'info' | 'warning' | 'error') => {
  Sentry.captureMessage(message, level);
};
```

### User Feedback
```tsx
// Use toast notifications instead of alerts
import { useToast } from '@/hooks/useToast';

function MyComponent() {
  const { toast } = useToast();

  const handleError = (error: Error) => {
    toast({
      title: 'Error',
      description: error.message,
      variant: 'destructive',
    });
  };

  return <div>{/* ... */}</div>;
}
```

---

## Accessibility (a11y) Standards

### WCAG 2.1 AA Compliance (Target Level)
- Color contrast ratio: ≥ 4.5:1 for normal text
- All interactive elements keyboard accessible
- Semantic HTML for all layouts
- ARIA labels for dynamic content
- Focus indicators visible

### Accessibility Testing
```typescript
// axe accessibility testing
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('should have no accessibility violations', async () => {
  const { container } = render(<MyComponent />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### Common Patterns
```tsx
// ✅ Always use semantic HTML
<button onClick={handleClick}>Click me</button>
<nav aria-label="Main navigation">...</nav>
<main>...</main>

// ✅ Label form inputs
<label htmlFor="email">Email</label>
<input id="email" type="email" />

// ✅ Provide ARIA labels for icons
<button aria-label="Close menu">
  <XIcon />
</button>

// ✅ Use proper heading hierarchy
<h1>Page Title</h1>
<h2>Section Title</h2>
```

---

## Authentication & Security

### Protected Routes Pattern
```typescript
// components/ProtectedRoute.tsx
import { useAuth } from '@/features/auth';
import { Navigate } from 'react-router-dom';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  
  return <>{children}</>;
}

// Usage
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route
    path="/dashboard"
    element={
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    }
  />
</Routes>
```

### Environment Variables Management
```bash
# .env.local (never commit, added to .gitignore)
VITE_API_BASE_URL=http://localhost:3000
VITE_SENTRY_DSN=https://...

# .env.production (can commit - public values only)
VITE_API_BASE_URL=https://api.example.com

# Access in code (Vite automatically exposes VITE_* variables)
const apiUrl = import.meta.env.VITE_API_BASE_URL;
const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;
```

**Security**: Never store secrets in `.env` files. Use your deployment platform's secret management (Vercel Secrets, Netlify Environment Variables, etc.).

### Session Management (Auth with Zustand)
```typescript
// store/authStore.ts
import { create } from 'zustand';
import { apiClient } from '@/services/api/client';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  verifySession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      // Server returns token in HTTP-only cookie automatically
      const user = await apiClient.post<User>('/auth/login', { email, password });
      set({ user, isAuthenticated: true });
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    try {
      // Server clears the HTTP-only cookie
      await apiClient.post('/auth/logout', {});
    } finally {
      set({ user: null, isAuthenticated: false });
    }
  },

  verifySession: async () => {
    set({ isLoading: true });
    try {
      // Verify token is valid (sent in HTTP-only cookie automatically)
      const user = await apiClient.get<User>('/auth/me');
      set({ user, isAuthenticated: true });
    } catch {
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

### Usage in App
```typescript
// App.tsx
import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';

function App() {
  const verifySession = useAuthStore((state) => state.verifySession);

  // Verify session on app load
  useEffect(() => {
    verifySession();
  }, [verifySession]);

  return (
    // App content
  );
}

// In a component
function Header() {
  const { user, isAuthenticated, logout } = useAuthStore();

  return (
    <header>
      {isAuthenticated ? (
        <>
          <span>Welcome, {user?.name}</span>
          <button onClick={logout}>Logout</button>
        </>
      ) : (
        <a href="/login">Login</a>
      )}
    </header>
  );
}
```

**Key Points**:
- ✅ Auth token stored in **HTTP-only cookie** (set by server) — can't be stolen via XSS
- ✅ User state managed in **Zustand** — reactive, type-safe, always in sync
- ✅ No localStorage/sessionStorage needed
- ✅ Logout clears server-side cookie automatically

---

## Performance Optimization

### Code Splitting & Lazy Loading
```typescript
import { lazy, Suspense } from 'react';
import { Spinner } from '@/components/Spinner';

const DashboardPage = lazy(() => import('@/features/dashboard/pages/DashboardPage'));
const SettingsPage = lazy(() => import('@/features/settings/pages/SettingsPage'));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Suspense>
  );
}
```

### Image Optimization

Prefer native `<img>` attributes. Only add an image component library if you need art direction or advanced optimization.

```tsx
<img
  src="/image-800.webp"
  srcSet="/image-400.webp 400w, /image-800.webp 800w, /image-1200.webp 1200w"
  sizes="(max-width: 800px) 100vw, 800px"
  width={800}
  height={600}
  alt="Description"
  loading="lazy"
  decoding="async"
/>
```

Guidelines:
- Use WebP or AVIF with a fallback `<picture>` source for older browsers
- Always provide `width` and `height` to reduce CLS
- Use `loading="lazy"` for below-the-fold images
- Use `srcSet` + `sizes` instead of serving one oversized image
- For art direction (cropped/mixed formats), use `<picture>` with `<source>` elements

### Bundle Analysis
```bash
# Analyze bundle size
pnpm add -D vite-plugin-visualizer

# In vite.config.ts
import { visualizer } from 'vite-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
});
```

### Web Vitals Targets
- **LCP (Largest Contentful Paint)**: < 2.5s
- **FID (First Input Delay)**: < 100ms
- **CLS (Cumulative Layout Shift)**: < 0.1

---

## Development Tooling

Most React tooling is shared with the Node.js stack. See `nodejs-project-tooling` for ESLint, Prettier, Husky, lint-staged, EditorConfig, and CI/CD setup.

### Recommended VS Code Extensions
- ESLint
- Prettier
- Tailwind CSS IntelliSense

---

## Conventions Checklist

Use this as a self-check when generating or reviewing React code:

- [ ] All API responses validated with Zod schemas
- [ ] Form inputs validated with Zod
- [ ] Prefer web standards (Fetch, native APIs) over third-party libraries
- [ ] No localStorage/sessionStorage used (use Zustand instead)
- [ ] No unnecessary dependencies (check if native API exists)
- [ ] Code follows TypeScript strict mode
- [ ] No `any` types used
- [ ] Components live in `src/features` or `src/shared/components`
- [ ] Custom hooks live in `hooks/` folder
- [ ] Services live in `services/` folder
- [ ] Global state managed with Zustand (if needed)
- [ ] Auth tokens in HTTP-only cookies (not in code)
- [ ] Tests alongside components (`*.test.tsx`)
- [ ] All interactive elements keyboard accessible
- [ ] Responsive design considered
- [ ] Error boundaries wrap major sections
- [ ] API calls use Fetch API with proper error handling
- [ ] Loading/error/empty states handled
- [ ] Dark mode supported
- [ ] No `console.log` in production code
- [ ] ESLint & Prettier passing
- [ ] Tests passing (target >80% coverage)

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `react-code-style` | React component patterns, hooks, forms, TypeScript props, React 19+ features |
| `nodejs-project-simple-api` | Standalone API server scaffolding (SPA+API pattern) |
| `nodejs-project-fullstack` | Full-stack patterns for Next.js or SPA + API |
| `project-context` | Capturing project-specific constraints, preferences, and decision log |
