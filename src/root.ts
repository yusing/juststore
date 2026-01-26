import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  getNestedValue,
  getSnapshot,
  isEqual,
  joinPath,
  notifyListeners,
  produce,
  rename,
  setLeaf,
  subscribe,
  useDebounce,
  useObject
} from './impl'
import { createRootNode } from './node'
import type { FieldPath, FieldPathValue, FieldValues } from './path'
import type {
  StoreRenderProps,
  StoreRoot,
  StoreSetStateValue,
  StoreShowProps,
  StoreUseComputeFn
} from './types'

export { createStoreRoot, type StoreOptions }

/**
 * Configuration options for store creation.
 */
type StoreOptions = {
  /** When true, the store only uses memory and does not persist to localStorage */
  memoryOnly?: boolean
}

/**
 * Creates the core store API with path-based methods.
 *
 * Uses a Proxy pattern for lazy initialization and caching of methods,
 * similar to the atom implementation. Methods are only created when first accessed
 * and then cached for subsequent use.
 *
 * @param namespace - Unique identifier for the store
 * @param defaultValue - Initial state merged with any persisted data
 * @param options - Configuration options
 * @returns A proxy object providing both path-based and dynamic property access to the store
 */
function createStoreRoot<T extends FieldValues>(
  namespace: string,
  defaultValue: T,
  options: StoreOptions = {}
): StoreRoot<T> {
  const memoryOnly = options?.memoryOnly ?? false
  // merge with default value and save in memory only
  produce(namespace, { ...defaultValue, ...(getSnapshot(namespace, memoryOnly) ?? {}) }, true, true)

  const storeApi: StoreRoot<T> = {
    state: <P extends FieldPath<T>>(path: P) => createRootNode(storeApi, path),
    use: <P extends FieldPath<T>>(path: P) =>
      useObject<T, P>(namespace, path, memoryOnly) as FieldPathValue<T, P>,
    useDebounce: <P extends FieldPath<T>>(path: P, delay: number) =>
      useDebounce<T, P>(namespace, path, delay, memoryOnly) as FieldPathValue<T, P>,
    set: <P extends FieldPath<T>>(
      path: P,
      value: StoreSetStateValue<FieldPathValue<T, P>>,
      skipUpdate = false
    ) => {
      if (typeof value !== 'function') {
        return setLeaf<T, P>(namespace, path, value, skipUpdate, memoryOnly)
      }
      const currentValue = storeApi.value(path)
      const newValue = value(currentValue)
      return setLeaf<T, P>(namespace, path, newValue, skipUpdate, memoryOnly)
    },
    value: <P extends FieldPath<T>>(path: P) =>
      getSnapshot(joinPath(namespace, path), memoryOnly) as FieldPathValue<T, P>,
    reset: <P extends FieldPath<T>>(path: P) => {
      return produce(
        joinPath(namespace, path),
        getNestedValue(defaultValue, path),
        false,
        memoryOnly
      )
    },
    rename: <P extends FieldPath<T>>(path: P, oldKey: string, newKey: string) =>
      rename(joinPath(namespace, path), oldKey, newKey, memoryOnly),
    subscribe: <P extends FieldPath<T>>(
      path: P,
      listener: (value: FieldPathValue<T, P>) => void
    ) => {
      const fullPath = joinPath(namespace, path)
      const unsubscribe = subscribe(fullPath, () =>
        listener(getSnapshot(fullPath, memoryOnly) as FieldPathValue<T, P>)
      )
      return unsubscribe
    },
    useCompute: <P extends FieldPath<T>, R>(
      path: P,
      fn: StoreUseComputeFn<T, P, R>,
      deps?: readonly unknown[]
    ) => {
      const fullPath = joinPath(namespace, path)
      const fnRef = useRef(fn)
      fnRef.current = fn

      const cacheRef = useRef<{
        path: string
        storeValue: unknown
        computed: R
        deps?: readonly unknown[]
      } | null>(null)

      const subscribeToPath = useCallback(
        (onStoreChange: () => void) => subscribe(fullPath, onStoreChange),
        [fullPath]
      )
      const getComputedSnapshot = useCallback(() => {
        if (cacheRef.current && cacheRef.current.path !== fullPath) {
          cacheRef.current = null
        }

        if (cacheRef.current && !isEqual(cacheRef.current.deps, deps)) {
          cacheRef.current = null
        }

        const storeValue = getSnapshot(fullPath, memoryOnly)
        if (cacheRef.current && isEqual(cacheRef.current.storeValue, storeValue)) {
          // same store value, return the same computed value
          return cacheRef.current.computed
        }
        const computedNext = fnRef.current(storeValue as FieldPathValue<T, P>)

        // Important: even if storeValue changed, we should avoid forcing a re-render
        // when the computed result is logically unchanged. `useSyncExternalStore`
        // uses `Object.is` on the snapshot; returning the same reference will bail out.
        if (cacheRef.current && isEqual(cacheRef.current.computed, computedNext)) {
          cacheRef.current.storeValue = storeValue
          return cacheRef.current.computed
        }

        cacheRef.current = { path: fullPath, storeValue, computed: computedNext, deps }
        return computedNext
      }, [fullPath, deps])

      return useSyncExternalStore(subscribeToPath, getComputedSnapshot, getComputedSnapshot)
    },
    notify: <P extends FieldPath<T>>(path: P) => {
      const value = getNestedValue(getSnapshot(namespace, memoryOnly), path)
      return notifyListeners(joinPath(namespace, path), value, value, {
        skipRoot: true,
        skipChildren: true,
        forceNotify: true
      })
    },
    useState: <P extends FieldPath<T>>(path: P) => {
      const fullPath = joinPath(namespace, path)
      const setValue = useCallback(
        <V extends FieldPathValue<T, P>>(value: StoreSetStateValue<V>) => {
          if (typeof value === 'function') {
            const currentValue = getSnapshot(fullPath, memoryOnly) as V
            const newValue = value(currentValue)
            return setLeaf<T, P>(namespace, path, newValue, false, memoryOnly)
          }
          return setLeaf<T, P>(namespace, path, value, false, memoryOnly)
        },
        [fullPath, path]
      )
      return [
        useObject<T, P>(namespace, path, memoryOnly) as FieldPathValue<T, P>,
        setValue
      ] as const
    },
    Render: <P extends FieldPath<T>>({ path, children }: StoreRenderProps<T, P>) => {
      const fullPath = joinPath(namespace, path)
      const value = useObject<T, P>(namespace, path, memoryOnly) as FieldPathValue<T, P>
      const update = useCallback(
        (value: StoreSetStateValue<FieldPathValue<T, P>>) => {
          if (typeof value === 'function') {
            const currentValue = getSnapshot(fullPath, memoryOnly) as FieldPathValue<T, P>
            const newValue = value(currentValue)
            return setLeaf(namespace, path, newValue, false, memoryOnly)
          }
          return setLeaf(namespace, path, value as FieldPathValue<T, P>, false, memoryOnly)
        },
        [fullPath, path]
      )
      return children(value, update)
    },
    Show: <P extends FieldPath<T>>({ path, children, on }: StoreShowProps<T, P>) => {
      const value = useObject<T, P>(namespace, path, memoryOnly) as FieldPathValue<T, P>
      if (!on(value)) {
        return null
      }
      return children
    }
  }

  return storeApi
}
