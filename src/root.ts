import { useCallback } from 'react'
import {
  getNestedValue,
  getSnapshot,
  isRecord,
  joinPath,
  notifyListeners,
  produce,
  rename,
  setLeaf,
  subscribe,
  useCompute,
  useDebounce,
  useObject
} from './impl'
import { createRootNode } from './node'
import type { FieldPath, FieldPathValue, FieldValues } from './path'
import type { StoreRoot, StoreSetStateValue, StoreUseComputeFn } from './types'

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
  'use memo'

  const memoryOnly = options?.memoryOnly ?? false
  // merge with default value and save in memory only
  produce(
    namespace,
    mergeWithDefaults(defaultValue, getSnapshot(namespace, memoryOnly)),
    true,
    true
  )

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
      return useCompute(namespace, path, fn, deps, memoryOnly)
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
      const setValue = useCallback(
        <V extends FieldPathValue<T, P>>(value: StoreSetStateValue<V>) => {
          storeApi.set(path, value, false)
        },
        [path]
      )
      return [
        useObject<T, P>(namespace, path, memoryOnly) as FieldPathValue<T, P>,
        setValue
      ] as const
    }
  }

  return storeApi
}

function mergeWithDefaults<T>(defaultValue: T, existingValue: unknown): T {
  if (existingValue === undefined) {
    return defaultValue
  }

  if (!isRecord(defaultValue) || !isRecord(existingValue)) {
    return existingValue as T
  }

  const defaults = defaultValue as Record<string, unknown>
  const existing = existingValue as Record<string, unknown>
  const merged: Record<string, unknown> = { ...existing }

  for (const key of Object.keys(defaults)) {
    merged[key] = mergeWithDefaults(defaults[key], existing[key])
  }

  return merged as T
}
