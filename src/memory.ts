import { useEffect, useId } from 'react'
import { disposeMemoryStore } from './impl'
import { createRootNode } from './node'
import type { FieldValues } from './path'
import { createStoreRoot } from './root'
import type { DeepProxy, State } from './types'

export { useMemoryStore, type MemoryStore }

/**
 * A component local store with React bindings.
 *
 * - Dot-path addressing for nested values (e.g. "state.ui.theme").
 * - Immutable partial updates with automatic object/array creation.
 * - Fine-grained subscriptions built on useSyncExternalStore.
 * - Type-safe paths using FieldPath.
 * - Dynamic deep access via Proxy for ergonomic usage like `state.a.b.c.use()` and `state.a.b.c.set(v)`.
 */
type MemoryStore<T extends FieldValues> = State<T> & {
  [K in keyof T]: NonNullable<T[K]> extends object ? DeepProxy<T[K]> : State<T[K]>
}
/**
 * React hook that creates a component-scoped memory store.
 *
 * Unlike `createStore`, this store is not persisted to localStorage and is
 * unique to each component instance. Useful for complex local state that
 * benefits from the store's path-based API without persistence.
 *
 * @param defaultValue - Initial state shape
 * @returns A proxy providing dynamic path access to the store
 *
 * @example
 * type SearchState = {
 *   query: string
 *   filters: { category: string }
 *   results: { id: number; name: string }[]
 * }
 *
 * function ProductSearch() {
 *   const state = useMemoryStore<SearchState>({
 *     query: '',
 *     filters: { category: 'all' },
 *     results: []
 *   })
 *
 *   return (
 *     <>
 *       <SearchInput state={state} />
 *       <FilterPanel state={state} />
 *     </>
 *   )
 * }
 *
 * function SearchInput({ state }: { state: MemoryStore<SearchState> }) {
 *   const query = state.query.use()
 *   return <input value={query} onChange={e => state.query.set(e.target.value)} />
 * }
 */
function useMemoryStore<T extends FieldValues>(defaultValue: T): MemoryStore<T> {
  const memoryStoreId = useId()
  const namespace = `memory:${memoryStoreId}`
  const storeApi = createStoreRoot(namespace, defaultValue, {
    memoryOnly: true
  })

  // Clean up memory store on unmount
  useEffect(() => {
    return () => {
      disposeMemoryStore(namespace)
    }
  }, [namespace])
  return createRootNode(storeApi) as MemoryStore<T>
}
