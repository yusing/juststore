import { createRootNode } from './node'
import type { FieldPath, FieldValues } from './path'
import { createStoreRoot, type StoreOptions } from './root'
import type { State, StoreRoot } from './types'

export { createStore, type Store }

/**
 * A persistent, hierarchical, cross-tab synchronized key-value store with React bindings.
 *
 * - Dot-path addressing for nested values (e.g. "config.ui.theme").
 * - Immutable partial updates with automatic object/array creation.
 * - Persists root namespaces to localStorage with an in-memory mirror (no localStorage on SSR).
 * - Cross-tab synchronization via BroadcastChannel (no-ops on SSR).
 * - Fine-grained subscriptions built on useSyncExternalStore.
 * - Type-safe paths using FieldPath.
 * - Dynamic deep access via Proxy for ergonomic usage like `store.a.b.c.use()` and `store.a.b.c.set(v)`.
 */
type Store<T extends FieldValues> = StoreRoot<T> & {
  [K in keyof T]-?: State<T[K]>
}

/**
 * Creates a persistent, hierarchical store with localStorage backing and cross-tab synchronization.
 *
 * @param namespace - Unique identifier for the store, used as the localStorage key prefix
 * @param defaultValue - Initial state shape; merged with any existing persisted data
 * @param options - Configuration options
 * @param options.memoryOnly - When true, disables localStorage persistence (default: false)
 * @returns A proxy object providing both path-based and dynamic property access to the store
 *
 * @example
 * const store = createStore('app', {
 *   user: { name: 'Guest' },
 *   todos: []
 * })
 *
 * // Dynamic access
 * store.user.name.use()
 * store.todos.push({ text: 'New todo' })
 *
 * // Path-based access
 * store.use('user.name')
 * store.set('user.name', 'Alice')
 */
function createStore<T extends FieldValues>(
  namespace: string,
  defaultValue: T,
  options: StoreOptions = {}
): Store<T> {
  const storeApi = createStoreRoot<T>(namespace, defaultValue, options)
  return new Proxy(storeApi, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof typeof target]
      }
      if (typeof prop === 'string' || typeof prop === 'number') {
        return createRootNode(target, prop as FieldPath<T>)
      }
      return undefined
    }
  }) as Store<T>
}
