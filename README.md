# juststore

A small, expressive, and type-safe state management library for React.

## Features

- Type-safe deep state with property-style access (`store.user.profile.name`)
- Path-based API for dynamic access (`store.use("user.profile.name")`)
- Fine-grained subscriptions powered by `useSyncExternalStore`
- Optional persistence + cross-tab sync (`createStore`)
- Memory-only scoped stores (`useMemoryStore`, `createMemoryStore`)
- Built-in form state + validation (`useForm`, `createForm`)
- Computed, derived, and mixed read models

## Installation

```bash
bun add juststore
```

## Quick Start

```tsx
import { createStore } from "juststore";
import { toast } from "sonner";

type AppState = {
  user: {
    name: string;
    preferences: {
      theme: "light" | "dark";
    };
  };
  todos: { id: number; text: string; done: boolean }[];
};

const store = createStore<AppState>("app", {
  user: {
    name: "Guest",
    preferences: { theme: "light" },
  },
  todos: [],
});

async function initUserDetails() {
  const response = await fetch("/api/user/details");
  const data = (await response.json()) as AppState["user"];
  store.user.set(data);
}

function ThemeToggle() {
  const theme = store.user.preferences.theme.use();
  const nextTheme = theme === "light" ? "dark" : "light";

  const updateTheme = async () => {
    try {
      const response = await fetch("/api/user/preferences/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: nextTheme }),
      });

      if (!response.ok) {
        throw new Error("Theme update failed");
      }

      store.user.preferences.theme.set(nextTheme);
    } catch {
      toast.error("Failed to update theme");
    }
  };

  return <button onClick={updateTheme}>Theme: {theme}</button>;
}
```

## Real-World Patterns

### 1) Debounced search + category filter

```tsx
type SearchState = {
  query: string;
  category: "all" | "running" | "stopped";
  services: { id: string; name: string; status: "running" | "stopped" }[];
};

const searchStore = createStore<SearchState>("services-search", {
  query: "",
  category: "all",
  services: [],
});

function SearchQueryInput() {
  const query = searchStore.query.use() ?? "";
  return (
    <input
      value={query}
      onChange={(e) => searchStore.query.set(e.target.value)}
      placeholder="Search services"
    />
  );
}

function SearchCategoryFilter() {
  const category = searchStore.category.use();
  return (
    <select
      value={category}
      onChange={(e) =>
        searchStore.category.set(e.target.value as SearchState["category"])
      }
    >
      <option value="all">All</option>
      <option value="running">Running</option>
      <option value="stopped">Stopped</option>
    </select>
  );
}

function SearchResults() {
  const query = searchStore.query.useDebounce(150) ?? "";
  const category = searchStore.category.use();

  const visible = searchStore.services.useCompute(
    (services) => {
      const list = services ?? [];
      return list.filter((service) => {
        const nameMatch = service.name
          .toLowerCase()
          .includes(query.toLowerCase());
        const categoryMatch =
          category === "all" ? true : service.status === category;
        return nameMatch && categoryMatch;
      });
    },
    [query, category],
  );

  return (
    <ul>
      {visible.map((service) => (
        <li key={service.id}>{service.name}</li>
      ))}
    </ul>
  );
}

function ServiceSearchPage() {
  return (
    <>
      <SearchQueryInput />
      <SearchCategoryFilter />
      <SearchResults />
    </>
  );
}
```

### 2) WebSocket ingestion into normalized state

```tsx
type RouteUptime = { alias: string; uptime: number };
type UptimeState = {
  routeKeys: string[];
  uptimeByAlias: Record<string, RouteUptime>;
};

const uptimeStore = createStore<UptimeState>("uptime", {
  routeKeys: [],
  uptimeByAlias: {},
});

function onUptimeMessage(rows: RouteUptime[]) {
  const keys = rows.map((row) => row.alias).toSorted();
  uptimeStore.routeKeys.set(keys);

  uptimeStore.uptimeByAlias.set(
    rows.reduce<Record<string, RouteUptime>>((acc, row) => {
      acc[row.alias] = row;
      return acc;
    }, {}),
  );
}

// fine grained subscription
function UptimeComponent({ alias }: { alias: string }) {
  const uptime = uptimeStore.uptimeByAlias[alias]?.uptime.use();
  return <div>Uptime: {uptime ?? "Unknown"}</div>;
}
```

### 3) Dynamic object keys for editable maps

```tsx
type HeaderState = {
  headers: Record<string, string>;
};

const headerStore = createStore<HeaderState>("route-headers", {
  headers: {},
});

function HeadersEditor() {
  // keys is a virtual property that returns a state proxy for the keys array
  // it only recomputes when the keys array changes
  const keys = headerStore.headers.keys.use();

  return (
    <div>
      {keys.map((key) => (
        <div key={key}>
          <input
            value={key}
            onChange={(e) =>
              headerStore.headers.rename(key, e.target.value.trim())
            }
          />
          {/* Render and update without cascade rerendering the entire HeadersEditor */}
          <RenderWithUpdate state={headerStore.headers[key]}>
            {(value, update) => (
              <input value={value} onChange={(e) => update(e.target.value)} />
            )}
          </RenderWithUpdate>
          <button onClick={() => headerStore.headers[key].reset()}>
            remove
          </button>
        </div>
      ))}
    </div>
  );
}
```

### 4) Typed form with validation and submit gating

```tsx
import { useForm } from "juststore";
import {
  StoreFormInputField,
  StoreFormPasswordField,
} from "@/components/store/Input"; // from juststore-shadcn

type LoginForm = {
  email: string;
  password: string;
};

function LoginPage() {
  const form = useForm<LoginForm>(
    { email: "", password: "" },
    {
      email: { validate: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      password: {
        validate: (value) =>
          value && value.length < 8 ? "Password too short" : undefined,
      },
    },
  );

  return (
    <form onSubmit={form.handleSubmit((values) => console.log(values))}>
      <StoreFormInputField
        state={form.email}
        type="email"
        title="Email"
        placeholder="you@example.com"
      />
      <StoreFormPasswordField
        state={form.password}
        title="Password"
        placeholder="At least 8 characters"
      />
      <button type="submit">Sign in</button>
    </form>
  );
}
```

### 5) Mixed read model for unified UI flags

```tsx
import { createMixedState, createStore } from "juststore";

type OpsState = {
  syncingConfig: boolean;
  savingRoute: boolean;
  reloadingAgent: boolean;
};

const opsStore = createStore<OpsState>("ops", {
  syncingConfig: false,
  savingRoute: false,
  reloadingAgent: false,
});

const busyState = createMixedState(
  opsStore.syncingConfig,
  opsStore.savingRoute,
  opsStore.reloadingAgent,
);

function GlobalBusyOverlay() {
  const isBusy = busyState.useCompute(
    ([syncingConfig, savingRoute, reloadingAgent]) =>
      syncingConfig || savingRoute || reloadingAgent,
  );

  if (!isBusy) return null;
  return <div className="overlay">Loading...</div>;
}

function BusyLabel() {
  const label = busyState.useCompute(
    ([syncingConfig, savingRoute, reloadingAgent]) => {
      if (syncingConfig) return "Syncing config...";
      if (savingRoute) return "Saving route...";
      if (reloadingAgent) return "Reloading agent...";
      return "Idle";
    },
  );

  return <span>{label}</span>;
}
```

## Core Usage

### Read and write state

```tsx
const name = store.user.name.use(); // subscribe
const current = store.user.name.value; // read without subscribe
store.user.name.set("Alice");
store.user.name.set((prev) => prev.toUpperCase());
```

### Path-based dynamic API

```tsx
store.set("user.name", "Alice");
const name = store.use("user.name");
const value = store.value("user.name");
```

### Arrays

```tsx
store.todos.push({ id: Date.now(), text: "new", done: false });
store.todos.at(0).done.set(true);
store.todos.sortedInsert((a, b) => a.id - b.id, {
  id: 2,
  text: "x",
  done: false,
});

const len = store.todos.length;
const liveLen = store.todos.useLength();
```

### Computed and derived values

```tsx
const total = store.cart.items.useCompute(
  (items) => items?.reduce((sum, item) => sum + item.price * item.qty, 0) ?? 0,
);

const fahrenheit = store.temperature.derived({
  from: (celsius) => ((celsius ?? 0) * 9) / 5 + 32,
  to: (f) => ((f - 32) * 5) / 9,
});
```

### Render helpers

```tsx
import { Conditional, Render, RenderWithUpdate } from "juststore";

<Render state={store.counter}>{(value) => <span>{value}</span>}</Render>;

<RenderWithUpdate state={store.counter}>
  {(value, update) => (
    <button onClick={() => update((value ?? 0) + 1)}>{value}</button>
  )}
</RenderWithUpdate>;

<Conditional state={store.user.role} on={(role) => role === "admin"}>
  <AdminPage />
</Conditional>;
```

## API Reference

## Top-Level Exports

- `createStore(namespace, defaultValue, options?)`
- `createMemoryStore(namespace, defaultValue)`
- `useMemoryStore(defaultValue)`
- `createForm(namespace, defaultValue, fieldConfigs?)`
- `useForm(defaultValue, fieldConfigs?)`
- `createMixedState(...states)`
- `createAtom(id, defaultValue, persistent?)`
- `Render`, `RenderWithUpdate`, `Conditional`, `ConditionalRender`
- `isEqual`
- All public types from `path`, `types`, and `form`

### `createStore(namespace, defaultValue, options?)`

Creates a persistent store (unless `options.memoryOnly` is true).

- `namespace: string` - storage namespace
- `defaultValue: T` - default root value
- `options?: { memoryOnly?: boolean }`

Returns a store that supports both:

- deep proxy usage (`store.user.name.use()`)
- path-based usage (`store.use("user.name")`)

### `createMemoryStore(namespace, defaultValue)` / `useMemoryStore(defaultValue)`

Creates memory-only stores (no localStorage persistence).

- `createMemoryStore` is useful outside React hooks or for explicit namespaces
- `useMemoryStore` creates component-scoped state keyed by `useId()`

### `createAtom(id, defaultValue, persistent?)`

Creates a scalar atom-like state.

- `persistent` defaults to `false`
- methods: `.value`, `.use()`, `.set(value | updater)`, `.reset()`, `.subscribe(listener)`, `.useCompute(fn, deps?)`

### `createForm(namespace, defaultValue, fieldConfigs?)` / `useForm(defaultValue, fieldConfigs?)`

Creates a form store with built-in error state and validation.

Field validators support:

- `"not-empty"`
- `RegExp`
- `(value, form) => string | undefined`

Additional form methods:

- `.useError()`
- `.error`
- `.setError(message | undefined)`
- `.clearErrors()`
- `.handleSubmit(onSubmit)`

### `createMixedState(...states)`

Combines multiple states into one read-only tuple-like state.

- `.value` returns current tuple
- `.use()` subscribes to all source states
- `.useCompute(fn)` computes derived values from the tuple

### Render utilities

- `Render` - render-prop helper for read-only usage
- `RenderWithUpdate` - render-prop helper with updater callback
- `Conditional` - show/hide children based on predicate; uses `Activity` so children stay mounted when hidden (state preserved)
- `ConditionalRender` - render only when predicate is true; children are a render prop receiving the value; returns `null` when false (unmounted)

## Store / State Methods

### Root store methods

| Method                           | Description                                     |
| -------------------------------- | ----------------------------------------------- |
| `.state(path)`                   | Returns a state proxy for the path              |
| `.use(path)`                     | Subscribes and returns current value            |
| `.useDebounce(path, delay)`      | Debounced subscription                          |
| `.useState(path)`                | `[value, setValue]` convenience tuple           |
| `.value(path)`                   | Reads current value without subscription        |
| `.set(path, value, skipUpdate?)` | Sets value (or updater function)                |
| `.reset(path)`                   | Resets path back to default value for that path |
| `.rename(path, oldKey, newKey)`  | Renames an object key                           |
| `.subscribe(path, listener)`     | Subscribes to path updates                      |
| `.useCompute(path, fn, deps?)`   | Computes memoized derived values                |
| `.notify(path)`                  | Forces listener notification for path           |

### Common state-node methods

Available on all nodes (`store.a.b.c`):

| Method                       | Description                     |
| ---------------------------- | ------------------------------- |
| `.value`                     | Read value without subscribing  |
| `.field`                     | Last path segment               |
| `.use()`                     | Subscribe and read              |
| `.useDebounce(delay)`        | Debounced subscribe/read        |
| `.useState()`                | `[value, setValue]`             |
| `.set(value, skipUpdate?)`   | Set value (or updater function) |
| `.reset()`                   | Reset path to default value     |
| `.subscribe(listener)`       | Subscribe to path changes       |
| `.useCompute(fn, deps?)`     | Compute derived value           |
| `.derived({ from, to })`     | Bidirectional virtual transform |
| `.ensureArray()`             | Array-safe state wrapper        |
| `.ensureObject()`            | Object-safe state wrapper       |
| `.withDefault(defaultValue)` | Fallback for nullish values     |
| `.notify()`                  | Forces listener notification    |

### Object-state additions

| Method                    | Description                 |
| ------------------------- | --------------------------- |
| `.keys`                   | Read-only stable keys state |
| `.rename(oldKey, newKey)` | Rename object key           |
| `[key]`                   | Nested field access         |

### Array-state additions

| Method                                   | Description              |
| ---------------------------------------- | ------------------------ |
| `.length`                                | Current length           |
| `.useLength()`                           | Subscribe to length only |
| `.at(index)` / `[index]`                 | Access item state        |
| `.push(...items)`                        | Push items               |
| `.pop()`                                 | Pop item                 |
| `.shift()`                               | Shift item               |
| `.unshift(...items)`                     | Unshift items            |
| `.splice(start, deleteCount?, ...items)` | Splice items             |
| `.reverse()`                             | Reverse array            |
| `.sort(compareFn?)`                      | Sort array               |
| `.fill(value, start?, end?)`             | Fill array               |
| `.copyWithin(target, start, end?)`       | Copy within array        |
| `.sortedInsert(cmp, ...items)`           | Insert by comparator     |

## Notes

- `createStore` persists by default; use `memoryOnly` for ephemeral data.
- `reset` restores default path value passed to `createStore`, it does not delete to `undefined`.

## License

AGPL-3.0
