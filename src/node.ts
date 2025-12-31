/* eslint-disable @typescript-eslint/no-explicit-any */
import { getStableKeys } from './impl'
import type { FieldPath, FieldPathValue, FieldValues } from './path'
import type { DerivedStateProps, ReadOnlyState, State, StoreRoot } from './types'

export { createNode, createRootNode, type Extension }

/**
 * Creates the root proxy node for dynamic path access.
 *
 * This is an internal function that wraps a store API in a Proxy, enabling
 * property-chain syntax like `store.user.profile.name.use()`.
 *
 * @param storeApi - The underlying store API with path-based methods
 * @param initialPath - Starting path segment (default: empty string for root)
 * @returns A proxy that intercepts property access and returns nested proxies or state methods
 */
function createRootNode<T extends FieldValues, P extends FieldPath<T>>(
  storeApi: StoreRoot<T>,
  initialPath: P = '' as P
): State<FieldPathValue<T, P>> {
  const proxyCache = new Map<string, any>()
  return createNode(storeApi, initialPath, proxyCache)
}

/**
 * Extension interface for adding custom getters/setters to proxy nodes.
 * Used internally by form handling to add error-related methods.
 */
type Extension = {
  /** Custom getter function */
  get?: () => any
  /** Custom setter function; returns true if the set was handled */
  set?: (value: any) => boolean
}

/**
 * Creates a proxy node for a specific path in the store.
 *
 * The proxy intercepts property access to provide state methods (use, set, value, etc.)
 * and recursively creates child proxies for nested paths. Supports derived state
 * transformations via the `from` and `to` parameters.
 *
 * @param storeApi - The underlying store API
 * @param path - Dot-separated path to this node (e.g., "user.profile.name")
 * @param cache - Shared cache to avoid recreating proxies for the same path
 * @param extensions - Optional custom getters/setters (used by form handling)
 * @param from - Transform function applied when reading values (for derived state)
 * @param to - Transform function applied when writing values (for derived state)
 * @returns A proxy implementing the State interface for the given path
 */
function createNode<T extends FieldValues>(
  storeApi: StoreRoot<any>,
  path: string,
  cache: Map<string, any>,
  extensions?: Record<string | symbol, Extension>,
  from = unchanged,
  to = unchanged
): State<T> {
  const isDerived = from !== unchanged || to !== unchanged
  const fieldName = path.split('.').pop()
  if (!isDerived && cache.has(path)) {
    return cache.get(path)
  }
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'field') {
          return fieldName
        }
        if (prop === 'use') {
          return () => from(storeApi.use(path))
        }
        if (prop === 'useDebounce') {
          return (delay: number) => from(storeApi.useDebounce(path, delay))
        }
        if (prop === 'useState') {
          return () => {
            const value = storeApi.use(path)
            return [from(value), (next: any) => storeApi.set(path, to(next))]
          }
        }
        if (prop === 'value') {
          return from(storeApi.value(path))
        }
        if (prop === 'set') {
          return (value: any, skipUpdate?: boolean) => storeApi.set(path, to(value), skipUpdate)
        }
        if (prop === 'reset') {
          return () => storeApi.reset(path)
        }
        if (prop === 'subscribe') {
          return (listener: (v: any) => void) =>
            storeApi.subscribe(path, value => listener(to(value)))
        }
        if (prop === 'Render') {
          return ({
            children
          }: {
            children: (value: any, update: (value: any) => void) => React.ReactNode
          }) =>
            storeApi.Render({
              path,
              children: (value, update) => children(from(value), value => update(to(value)))
            })
        }
        if (prop === 'Show') {
          return ({ children, on }: { children: React.ReactNode; on: (value: any) => boolean }) =>
            storeApi.Show({ path, children, on: value => on(from(value)) })
        }
        if (prop === 'useCompute') {
          return <R>(fn: (value: any) => R) => {
            return storeApi.useCompute(path, value => fn(from(value)))
          }
        }
        if (prop === 'derived') {
          if (isDerived) {
            throw new Error(`Derived method cannot be called on a derived node: ${path}`)
          }
          return ({ from, to }: DerivedStateProps<any, any>) =>
            createNode(storeApi, path, cache, extensions, from, to)
        }
        if (prop === 'notify') {
          return () => storeApi.notify(path)
        }
        if (prop === 'ensureArray') {
          return () =>
            createNode(
              storeApi,
              path,
              cache,
              extensions,
              value => ensureArray(value, from),
              unchanged
            )
        }
        if (prop === 'ensureObject') {
          return () =>
            createNode(storeApi, path, cache, extensions, value => ensureObject(value, from), to)
        }
        if (prop === 'withDefault') {
          return (defaultValue: T) =>
            createNode(
              storeApi,
              path,
              cache,
              extensions,
              value => withDefault(value, defaultValue, from),
              to
            )
        }

        if (isObjectMethod(prop)) {
          const derivedValue = from(storeApi.value(path))
          if (derivedValue !== undefined && typeof derivedValue !== 'object') {
            throw new Error(`Expected object at path ${path}, got ${typeof derivedValue}`)
          }

          if (prop === 'rename') {
            return (oldKey: string, newKey: string) => storeApi.rename(path, oldKey, newKey)
          }
          if (prop === 'keys') {
            const cacheKey = `${path}.__juststore_keys`
            if (!isDerived && cache.has(cacheKey)) {
              return cache.get(cacheKey)
            }
            const keysNode = createKeysNode(storeApi, path, value => ensureObject(value, from))
            if (!isDerived) {
              cache.set(cacheKey, keysNode)
            }
            return keysNode
          }
        }

        if (isArrayMethod(prop)) {
          const derivedValue = from(storeApi.value(path))

          if (derivedValue !== undefined && !Array.isArray(derivedValue)) {
            throw new Error(`Expected array at path ${path}, got ${typeof derivedValue}`)
          }

          const currentArray = derivedValue ? [...derivedValue] : []
          if (prop === 'at') {
            return (index: number) => {
              const nextPath = path ? `${path}.${index}` : String(index)
              return createNode(storeApi, nextPath, cache, extensions)
            }
          }
          if (prop === 'length') {
            return currentArray.length
          }

          // Array mutation methods
          if (prop === 'push') {
            return (...items: any[]) => {
              const newArray = [...currentArray, ...items]
              storeApi.set(path as any, isDerived ? newArray.map(to) : newArray)
              return newArray.length
            }
          }
          if (prop === 'pop') {
            return () => {
              if (currentArray.length === 0) return undefined
              const newArray = currentArray.slice(0, -1)
              const poppedItem = currentArray[currentArray.length - 1]
              storeApi.set(path as any, isDerived ? newArray.map(to) : newArray)
              return poppedItem
            }
          }
          if (prop === 'shift') {
            return () => {
              if (currentArray.length === 0) return undefined
              const newArray = currentArray.slice(1)
              const shiftedItem = currentArray[0]
              storeApi.set(path as any, isDerived ? newArray.map(to) : newArray)
              return shiftedItem
            }
          }
          if (prop === 'unshift') {
            return (...items: any[]) => {
              const newArray = [...items, ...currentArray]
              storeApi.set(path as any, isDerived ? newArray.map(to) : newArray)
              return newArray.length
            }
          }
          if (prop === 'splice') {
            return (start: number, deleteCount?: number, ...items: any[]) => {
              const deletedItems = currentArray.splice(start, deleteCount ?? 0, ...items)
              storeApi.set(path as any, isDerived ? currentArray.map(to) : currentArray)
              return deletedItems
            }
          }
          if (prop === 'reverse') {
            return () => {
              if (!Array.isArray(currentArray)) return []
              currentArray.reverse()
              storeApi.set(path as any, isDerived ? currentArray.map(to) : currentArray)
              return currentArray
            }
          }
          if (prop === 'sort') {
            return (compareFn?: (a: any, b: any) => number) => {
              currentArray.sort(compareFn)
              storeApi.set(path as any, isDerived ? currentArray.map(to) : currentArray)
              return currentArray
            }
          }
          if (prop === 'fill') {
            return (value: any[], start?: number, end?: number) => {
              currentArray.fill(value, start, end)
              storeApi.set(path as any, isDerived ? currentArray.map(to) : currentArray)
              return currentArray
            }
          }
          if (prop === 'copyWithin') {
            return (target: number, start: number, end?: number) => {
              currentArray.copyWithin(target, start, end)
              storeApi.set(path as any, isDerived ? currentArray.map(to) : currentArray)
              return currentArray
            }
          }
          if (prop === 'sortedInsert') {
            return (cmp: (a: any, b: any) => number, ...items: any[]) => {
              if (typeof cmp !== 'function') return currentArray.length

              const newArray = [...currentArray]

              for (const item of items) {
                let left = 0
                let right = newArray.length

                // Binary search to find insertion point
                while (left < right) {
                  const mid = (left + right) >>> 1
                  if (cmp(newArray[mid], item) <= 0) {
                    left = mid + 1
                  } else {
                    right = mid
                  }
                }

                // Insert at the found position
                newArray.splice(left, 0, item)
              }

              storeApi.set(path, isDerived ? newArray.map(to) : newArray)
              return newArray.length
            }
          }
        }

        if (extensions?.[prop]?.get) {
          return extensions[prop]?.get()
        }

        if (typeof prop === 'string' || typeof prop === 'number') {
          const nextPath = path ? `${path}.${prop}` : String(prop)
          return createNode(storeApi, nextPath, cache, extensions)
        }
        return undefined
      },
      set(_target, prop, value) {
        if (extensions?.[prop]?.set) {
          return extensions[prop]?.set(value)
        }
        if (typeof prop === 'string' || typeof prop === 'number') {
          const nextPath = path ? `${path}.${prop}` : String(prop)
          storeApi.set(nextPath, to(value))
          return true
        }
        return false
      }
    }
  )
  if (!isDerived) {
    cache.set(path, proxy)
  }
  return proxy as State<T>
}

function isArrayMethod(prop: string | symbol) {
  return (
    prop === 'at' ||
    prop === 'length' ||
    prop === 'push' ||
    prop === 'pop' ||
    prop === 'shift' ||
    prop === 'unshift' ||
    prop === 'splice' ||
    prop === 'reverse' ||
    prop === 'sort' ||
    prop === 'fill' ||
    prop === 'copyWithin' ||
    prop === 'sortedInsert'
  )
}

function isObjectMethod(prop: string | symbol) {
  return prop === 'rename' || prop === 'keys'
}

function unchanged(value: any) {
  return value
}

const EMPTY_ARRAY: readonly never[] = []
const EMPTY_OBJECT: Readonly<Record<string, never>> = {}

function createKeysNode(
  storeApi: StoreRoot<any>,
  path: string,
  getObjectValue: (value: any) => Readonly<Record<string, any>>
): ReadOnlyState<string[]> {
  const signalPath = path ? `${path}.__juststore_keys` : '__juststore_keys'
  const computeKeys = () => {
    return getStableKeys(getObjectValue(storeApi.value(path)))
  }

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'use') return () => storeApi.useCompute(signalPath, computeKeys)
        if (prop === 'value') return computeKeys()
        if (prop === 'useCompute') {
          return <R>(fn: (value: any) => R) => {
            return storeApi.useCompute(signalPath, () => fn(computeKeys()))
          }
        }
        if (prop === 'Render') {
          return ({ children }: { children: (value: any, update: (value: any) => void) => any }) =>
            children(storeApi.useCompute(signalPath, computeKeys), () => {})
        }
        if (prop === 'Show') {
          return ({ children, on }: { children: any; on: (value: any) => boolean }) => {
            const value = storeApi.useCompute(signalPath, computeKeys)
            if (!on(value)) return null
            return children
          }
        }
        return undefined
      }
    }
  ) as ReadOnlyState<string[]>
}

function ensureArray(value: any, from: (value: any) => any) {
  if (value === undefined || value === null) return EMPTY_ARRAY
  const array = from(value)
  if (Array.isArray(array)) return array
  return EMPTY_ARRAY
}

function ensureObject(value: any, from: (value: any) => any) {
  if (value === undefined || value === null) return EMPTY_OBJECT
  const obj = from(value)
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
  return EMPTY_OBJECT
}

function withDefault(value: any, defaultValue: any, from: (value: any) => any) {
  if (value === undefined || value === null) return defaultValue // defaultValue should've already matched the type
  return from(value)
}
