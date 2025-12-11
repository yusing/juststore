import { useCallback, useRef, useState } from 'react'
import {
  getNestedValue,
  getSnapshot,
  isEqual,
  joinPath,
  notifyListeners,
  produce,
  setLeaf,
  useDebounce,
  useObject,
  useSubscribe
} from './impl'
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
    subscribe: <P extends FieldPath<T>>(path: P, listener: (value: FieldPathValue<T, P>) => void) =>
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useSubscribe<FieldPathValue<T, P>>(joinPath(namespace, path), listener),
    useCompute: <P extends FieldPath<T>, R>(path: P, fn: (value: FieldPathValue<T, P>) => R) => {
      const fullPath = joinPath(namespace, path)
      const initialValue = getSnapshot(fullPath) as FieldPathValue<T, P>
      const [computedValue, setComputedValue] = useState(() => fn(initialValue))
      useSubscribe(fullPath, value => {
        const newValue = fn(value as FieldPathValue<T, P>)
        if (!isEqual(computedValue, newValue)) {
          setComputedValue(newValue)
        }
      })
      return computedValue
    },
    notify: <P extends FieldPath<T>>(path: P) => {
      const value = getNestedValue(getSnapshot(namespace), path)
      return notifyListeners(joinPath(namespace, path), value, value, true, true)
    },
    useState: <P extends FieldPath<T>>(path: P) => {
      const fullPathRef = useRef(joinPath(namespace, path))
      const setValue = useCallback(
        <V extends FieldPathValue<T, P> | undefined>(value: V | ((prev: V) => V)) => {
          if (typeof value === 'function') {
            const currentValue = getSnapshot(fullPathRef.current) as V
            const newValue = value(currentValue)
            return setLeaf<T, P>(namespace, path, newValue, false, memoryOnly)
          }
          return setLeaf<T, P>(namespace, path, value, false, memoryOnly)
        },
        [path]
      )
      return [useObject<T, P>(fullPathRef.current), setValue] as const
    },
    Render: <P extends FieldPath<T>>({ path, children }: StoreRenderProps<T, P>) => {
      const fullPathRef = useRef(joinPath(namespace, path))
      const value = useObject<T, P>(fullPathRef.current)
      const update = useCallback(
        (
          value:
            | FieldPathValue<T, P>
            | ((prev: FieldPathValue<T, P> | undefined) => FieldPathValue<T, P>)
            | undefined
        ) => {
          if (typeof value === 'function') {
            const currentValue = getSnapshot(fullPathRef.current) as
              | FieldPathValue<T, P>
              | undefined
            const newValue = value(currentValue)
            return setLeaf(namespace, path, newValue, false, memoryOnly)
          }
          return setLeaf(namespace, path, value, false, memoryOnly)
        },
        [path]
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
