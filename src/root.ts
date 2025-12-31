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
  useObject,
  useSubscribe
} from './impl'
import { createRootNode } from './node'
import type { FieldPath, FieldPathValue, FieldValues } from './path'
import type { StoreRenderProps, StoreRoot, StoreShowProps } from './types'

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
 * This is an internal function that sets up the subscription system, persistence,
 * and provides the base API that the proxy wraps. The returned object contains
 * methods like `use`, `set`, `value`, etc. that accept path strings.
 *
 * @param namespace - Unique identifier for the store
 * @param defaultValue - Initial state merged with any persisted data
 * @param options - Configuration options
 * @returns The store API object with path-based methods
 */
function createStoreRoot<T extends FieldValues>(
  namespace: string,
  defaultValue: T,
  options: StoreOptions = {}
) {
  const memoryOnly = options?.memoryOnly ?? false
  if (memoryOnly) {
    produce(namespace, undefined, true, false) // clear localStorage value
  }
  produce(namespace, { ...defaultValue, ...(getSnapshot(namespace) ?? {}) }, true, true)

  const storeApi: StoreRoot<T> = {
    state: <P extends FieldPath<T>>(path: P) => createRootNode(storeApi, path),
    use: <P extends FieldPath<T>>(path: P) => useObject<T, P>(namespace, path),
    useDebounce: <P extends FieldPath<T>>(path: P, delay: number) =>
      useDebounce<T, P>(namespace, path, delay),
    set: <P extends FieldPath<T>>(
      path: P,
      value:
        | FieldPathValue<T, P>
        | ((prev: FieldPathValue<T, P> | undefined) => FieldPathValue<T, P>),
      skipUpdate = false
    ) => {
      const currentValue = storeApi.value(path)
      const newValue =
        typeof value === 'function'
          ? (value as (prev: FieldPathValue<T, P> | undefined) => FieldPathValue<T, P>)(
              currentValue
            )
          : value
      return setLeaf<T, P>(namespace, path, newValue, skipUpdate, memoryOnly)
    },
    value: <P extends FieldPath<T>>(path: P) =>
      getSnapshot(joinPath(namespace, path)) as FieldPathValue<T, P>,
    reset: <P extends FieldPath<T>>(path: P) =>
      produce(joinPath(namespace, path), undefined, false, memoryOnly),
    rename: <P extends FieldPath<T>>(path: P, oldKey: string, newKey: string) =>
      rename(joinPath(namespace, path), oldKey, newKey),
    subscribe: <P extends FieldPath<T>>(path: P, listener: (value: FieldPathValue<T, P>) => void) =>
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useSubscribe<FieldPathValue<T, P>>(joinPath(namespace, path), listener),
    useCompute: <P extends FieldPath<T>, R>(
      path: P,
      fn: (value: FieldPathValue<T, P>) => R,
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

        const storeValue = getSnapshot(fullPath)
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
      const value = getNestedValue(getSnapshot(namespace), path)
      return notifyListeners(joinPath(namespace, path), value, value, {
        skipRoot: true,
        skipChildren: true,
        forceNotify: true
      })
    },
    useState: <P extends FieldPath<T>>(path: P) => {
      const fullPath = joinPath(namespace, path)
      const setValue = useCallback(
        <V extends FieldPathValue<T, P> | undefined>(value: V | ((prev: V) => V)) => {
          if (typeof value === 'function') {
            const currentValue = getSnapshot(fullPath) as V
            const newValue = value(currentValue)
            return setLeaf<T, P>(namespace, path, newValue, false, memoryOnly)
          }
          return setLeaf<T, P>(namespace, path, value, false, memoryOnly)
        },
        [fullPath, path]
      )
      return [useObject<T, P>(namespace, path), setValue] as const
    },
    Render: <P extends FieldPath<T>>({ path, children }: StoreRenderProps<T, P>) => {
      const fullPath = joinPath(namespace, path)
      const value = useObject<T, P>(namespace, path)
      const update = useCallback(
        (
          value:
            | FieldPathValue<T, P>
            | ((prev: FieldPathValue<T, P> | undefined) => FieldPathValue<T, P>)
            | undefined
        ) => {
          if (typeof value === 'function') {
            const currentValue = getSnapshot(fullPath) as FieldPathValue<T, P> | undefined
            const newValue = value(currentValue)
            return setLeaf(namespace, path, newValue, false, memoryOnly)
          }
          return setLeaf(namespace, path, value, false, memoryOnly)
        },
        [fullPath, path]
      )
      return children(value, update)
    },
    Show: <P extends FieldPath<T>>({ path, children, on }: StoreShowProps<T, P>) => {
      const value = useObject<T, P>(namespace, path)
      if (!on(value)) {
        return null
      }
      return children
    }
  }

  return storeApi
}
