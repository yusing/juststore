# juststore

A small, expressive, and type-safe state management library for React.

## Features

- **Dot-path addressing** - Access nested values using paths like `store.user.profile.name`
- **Type-safe paths** - Full TypeScript inference for nested property access
- **Fine-grained subscriptions** - Components only re-render when their specific data changes
- **localStorage persistence** - Automatic persistence with cross-tab synchronization via BroadcastChannel
- **Memory-only stores** - Component-scoped state that doesn't persist
- **Form handling** - Built-in validation and error management
- **Array operations** - Native array methods (push, pop, splice, etc.) on array paths
- **Derived state** - Transform values bidirectionally without extra storage
- **SSR compatible** - Safe to use in server-side rendering environments

## Installation

```bash
npm install juststore
# or
bun add juststore
```

## Quick Start

```tsx
import { createStore } from 'juststore'

type AppState = {
  user: {
    name: string
    preferences: {
      theme: 'light' | 'dark'
    }
  }
  todos: { id: number; text: string; done: boolean }[]
}

const store = createStore<AppState>('app', {
  user: {
    name: 'Guest',
    preferences: { theme: 'light' }
  },
  todos: []
})
```

## Real-World Examples (GoDoxy Web UI)

### Homepage navigation and search

```tsx
import { store } from '@/components/home/store'

function HomepageFilters() {
  const categories = store.homepageCategories.use()
  const [activeCategory, setActiveCategory] = store.navigation.activeCategory.useState()
  const query = store.searchQuery.useDebounce(150)

  const visibleItems =
    categories
      .find(cat => cat.name === activeCategory)
      ?.items.filter(item => item.name.toLowerCase().includes((query ?? '').toLowerCase())) ?? []

  return (
    <div>
      <input
        value={query ?? ''}
        onChange={e => store.searchQuery.set(e.target.value)}
        placeholder="Search services"
      />
      <div>
        {categories.map(name => (
          <button
            key={name}
            data-active={name === activeCategory}
            onClick={() => setActiveCategory(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <ul>
        {visibleItems.map(item => (
          <li key={item.name}>{item.name}</li>
        ))}
      </ul>
    </div>
  )
}
```

### Live route uptime sidebar

```tsx
import { useWebSocketApi } from '@/hooks/websocket'
import type { RouteKey } from '@/components/routes/store'
import { store } from '@/components/routes/store'
import type { RouteUptimeAggregate, UptimeAggregate } from '@/lib/api'

function RoutesUptimeProvider() {
  useWebSocketApi<UptimeAggregate>({
    endpoint: '/metrics/uptime',
    query: { period: '1d' },
    onMessage: uptime => {
      const keys = uptime.data.map(route => route.alias as RouteKey)
      store.set('routeKeys', keys.toSorted())
      store.set(
        'uptime',
        keys.reduce(
          (acc, key, index) => {
            acc[key] = uptime.data[index] as RouteUptimeAggregate
            return acc
          },
          {} as Record<RouteKey, RouteUptimeAggregate>
        )
      )
    }
  })

  return null
}
```

### Server metrics via WebSockets

```tsx
import { useWebSocketApi } from '@/hooks/websocket'
import { store } from '@/components/servers/store'
import type { MetricsPeriod, SystemInfoAggregate, SystemInfoAggregateMode } from '@/lib/api'

const MODES: SystemInfoAggregateMode[] = [
  'cpu_average',
  'memory_usage',
  'disks_read_speed',
  'disks_write_speed',
  'disks_iops',
  'disk_usage',
  'network_speed',
  'network_transfer',
  'sensor_temperature'
]

function SystemInfoGraphsProvider({ agent, period }: { agent: string; period: MetricsPeriod }) {
  MODES.forEach(mode => {
    useWebSocketApi<SystemInfoAggregate>({
      endpoint: '/metrics/system_info',
      query: {
        period,
        aggregate: mode,
        agent_name: agent === 'Main Server' ? '' : agent
      },
      onMessage: data => {
        store.systemInfoGraphs[agent]?.[period]?.[mode]?.set(data)
      }
    })
  })

  return null
}
```

## Usage

### Reading State

```tsx
function UserName() {
  // Subscribe to a specific path - re-renders only when this value changes
  const name = store.user.name.use()
  return <span>{name}</span>
}

function Theme() {
  // Deep path access
  const theme = store.user.preferences.theme.use()
  return <span>Current theme: {theme}</span>
}
```

### Writing State

```tsx
function Settings() {
  return <button onClick={() => store.user.preferences.theme.set('dark')}>Dark Mode</button>
}

// Functional updates
store.user.name.set(prev => prev.toUpperCase())

// Read without subscribing
const currentName = store.user.name.value
```

### useState-style Hook

```tsx
function EditableName() {
  const [name, setName] = store.user.name.useState()
  return <input value={name ?? ''} onChange={e => setName(e.target.value)} />
}
```

### Debounced Values

```tsx
function SearchResults() {
  // Value updates are debounced by 300ms
  const query = store.search.query.useDebounce(300)
  // fetch results based on debounced query...
}
```

### Array Operations

```tsx
function TodoList() {
  const todos = store.todos.use()

  const addTodo = () => {
    store.todos.push({ id: Date.now(), text: 'New todo', done: false })
  }

  const removeFirst = () => {
    store.todos.shift()
  }

  const toggleTodo = (index: number) => {
    store.todos.at(index).done.set(prev => !prev)
  }

  return (
    <ul>
      {todos?.map((todo, i) => (
        <li key={todo.id} onClick={() => toggleTodo(i)}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}
```

Available array methods: `push`, `pop`, `shift`, `unshift`, `splice`, `reverse`, `sort`, `fill`, `copyWithin`, `sortedInsert`.

### Render Props

```tsx
function Counter() {
  return (
    <store.counter.Render>
      {(value, update) => (
        <button onClick={() => update((value ?? 0) + 1)}>Count: {value ?? 0}</button>
      )}
    </store.counter.Render>
  )
}
```

### Conditional Rendering

```tsx
function AdminPanel() {
  return (
    <store.user.role.Show on={role => role === 'admin'}>
      <AdminDashboard />
    </store.user.role.Show>
  )
}
```

### Derived State

Transform values without storing the transformed version:

```tsx
function TemperatureInput() {
  // Store holds Celsius, but we want to display/edit Fahrenheit
  const fahrenheit = store.temperature.derived({
    from: celsius => ((celsius ?? 0) * 9) / 5 + 32,
    to: fahrenheit => ((fahrenheit - 32) * 5) / 9
  })

  const [temp, setTemp] = fahrenheit.useState()
  return <input type="number" value={temp} onChange={e => setTemp(Number(e.target.value))} />
}
```

### Computed Values

```tsx
function TotalPrice() {
  const total = store.cart.items.useCompute(
    items => items?.reduce((sum, item) => sum + item.price * item.qty, 0) ?? 0
  )
  return <span>Total: ${total}</span>
}
```

### Memory-Only Stores

For complex component-local state with nested structures. Useful when you need to pass state to child components without prop drilling:

```tsx
import { useMemoryStore, type MemoryStore } from 'juststore'

type SearchState = {
  query: string
  filters: { category: string; minPrice: number }
  results: { id: number; name: string }[]
}

function ProductSearch() {
  const state = useMemoryStore<SearchState>({
    query: '',
    filters: { category: 'all', minPrice: 0 },
    results: []
  })

  return (
    <>
      <SearchInput state={state} />
      <FilterPanel state={state} />
      <ResultsList state={state} />
    </>
  )
}

function SearchInput({ state }: { state: MemoryStore<SearchState> }) {
  const query = state.query.use()
  return <input value={query} onChange={e => state.query.set(e.target.value)} />
}

function FilterPanel({ state }: { state: MemoryStore<SearchState> }) {
  const category = state.filters.category.use()
  return (
    <select value={category} onChange={e => state.filters.category.set(e.target.value)}>
      <option value="all">All</option>
      <option value="electronics">Electronics</option>
    </select>
  )
}

function ResultsList({ state }: { state: MemoryStore<SearchState> }) {
  const results = state.results.use()
  return (
    <ul>
      {results?.map(r => (
        <li key={r.id}>{r.name}</li>
      ))}
    </ul>
  )
}
```

### Form Handling

```tsx
import { useForm } from 'juststore'

type LoginForm = {
  email: string
  password: string
}

function LoginPage() {
  const form = useForm<LoginForm>(
    { email: '', password: '' },
    {
      email: { validate: 'not-empty' },
      password: {
        validate: value => (value && value.length < 8 ? 'Password too short' : undefined)
      }
    }
  )

  return (
    <form onSubmit={form.handleSubmit(values => console.log(values))}>
      <input value={form.email.use() ?? ''} onChange={e => form.email.set(e.target.value)} />
      {form.email.useError() && <span>{form.email.error}</span>}

      <input
        type="password"
        value={form.password.use() ?? ''}
        onChange={e => form.password.set(e.target.value)}
      />
      {form.password.useError() && <span>{form.password.error}</span>}

      <button type="submit">Login</button>
    </form>
  )
}
```

Validation options:

- `'not-empty'` - Field must have a value
- `RegExp` - Value must match the pattern
- `(value, form) => string | undefined` - Custom validation function

### Mixed State

Combine multiple state values into a single subscription:

```tsx
import { createMixedState } from 'juststore'

function LoadingOverlay() {
  const loading = createMixedState(store.saving, store.fetching, store.uploading)

  return (
    <loading.Show on={([saving, fetching, uploading]) => saving || fetching || uploading}>
      <Spinner />
    </loading.Show>
  )
}
```

### Path-based API

The store also exposes a path-based API for dynamic access:

```tsx
// Equivalent to store.user.name.use()
const name = store.use('user.name')

// Equivalent to store.user.name.set('Alice')
store.set('user.name', 'Alice')

// Equivalent to store.user.name.value
const current = store.value('user.name')
```

## API Reference

### createStore(namespace, defaultValue, options?)

Creates a persistent store with localStorage backing and cross-tab sync.

- `namespace` - Unique identifier for the store
- `defaultValue` - Initial state shape
- `options.memoryOnly` - Disable persistence (default: false)

### useMemoryStore(defaultValue)

Creates a component-scoped store that doesn't persist.

### useForm(defaultValue, fieldConfigs?)

Creates a form store with validation support.

### Root Node Methods

The store root provides path-based methods for dynamic access:

| Method                          | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `.state(path)`                  | Get the state object for a path                         |
| `.use(path)`                    | Subscribe and read value (triggers re-render on change) |
| `.useDebounce(path, ms)`        | Subscribe with debounced updates                        |
| `.useState(path)`               | Returns `[value, setValue]` tuple                       |
| `.value(path)`                  | Read without subscribing                                |
| `.set(path, value)`             | Update value                                            |
| `.set(path, fn)`                | Functional update                                       |
| `.reset(path)`                  | Delete value at path                                    |
| `.rename(path, oldKey, newKey)` | Rename a key in an object                               |
| `.keys(path)`                   | Get the readonly state of keys of an object             |
| `.subscribe(path, fn)`          | Subscribe to changes (for effects)                      |
| `.notify(path)`                 | Manually trigger subscribers                            |
| `.useCompute(path, fn)`         | Derive a computed value                                 |
| `.Render({ path, children })`   | Render prop component                                   |
| `.Show({ path, children, on })` | Conditional render component                            |

### Common State Methods

Available on all state types (values, objects, arrays):

| Method                       | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| `.value`                     | Read without subscribing                                            |
| `.field`                     | The field name for the proxy                                        |
| `.use()`                     | Subscribe and read value (triggers re-render on change)             |
| `.useDebounce(ms)`           | Subscribe with debounced updates                                    |
| `.useState()`                | Returns `[value, setValue]` tuple                                   |
| `.set(value)`                | Update value                                                        |
| `.set(fn)`                   | Functional update                                                   |
| `.reset()`                   | Delete value at path                                                |
| `.subscribe(fn)`             | Subscribe to changes (for effects)                                  |
| `.notify()`                  | Manually trigger subscribers                                        |
| `.useCompute(fn)`            | Derive a computed value                                             |
| `.derived({ from, to })`     | Create bidirectional transform                                      |
| `.ensureArray()`             | Get array state for the value                                       |
| `.ensureObject()`            | Get object state for the value                                      |
| `.withDefault(defaultValue)` | Return a new state with a default value, and make the type non-nullable |
| `.Render({ children })`      | Render prop component                                               |
| `.Show({ children, on })`    | Conditional render component                                        |

### Object State Methods

Additional methods available on object states:

| Method                    | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `.keys`                   | Readonly state of object keys                         |
| `.rename(oldKey, newKey)` | Rename a key in an object                             |
| `[key: string]`           | Access nested property state by key                   |

### Array State Methods

Additional methods available on array states:

| Method                   | Description                                                                       |
| ------------------------ | --------------------------------------------------------------------------------- |
| `.length`                | Read the array length without subscribing                                         |
| `.useLength()`           | Subscribe to array length changes                                                 |
| `.push(...items)`        | Add items to the end                                                              |
| `.pop()`                 | Remove and return the last item                                                   |
| `.shift()`               | Remove and return the first item                                                  |
| `.unshift(...items)`     | Add items to the beginning                                                        |
| `.splice(start, deleteCount, ...items)` | Remove/replace items                                      |
| `.reverse()`             | Reverse the array in place                                                        |
| `.sort(compareFn)`       | Sort the array in place                                                           |
| `.fill(value, start, end)` | Fill the array with a value                                                    |
| `.copyWithin(target, start, end)` | Copy part of the array within itself                                 |
| `.sortedInsert(cmp, ...items)` | Insert items in sorted order using comparison function                      |
| `.at(index)`             | Access element at index (returns proxy)                                           |
| `[index: number]`        | Access element at index (returns proxy)                                           |

## License

AGPL-3.0
