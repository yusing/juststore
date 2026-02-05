import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import rfcIsEqual from 'react-fast-compare'
import { KVStore } from './kv_store'
import type { FieldPath, FieldPathValue, FieldValues } from './path'
import { getExternalKeyOrder, getStableKeys, setExternalKeyOrder } from './stable_keys'

export {
  getNestedValue,
  getSnapshot,
  getStableKeys,
  isClass,
  isEqual,
  isRecord,
  joinPath,
  notifyListeners,
  produce,
  rename,
  setExternalKeyOrder,
  setLeaf,
  setNestedValue,
  subscribe,
  testReset,
  updateSnapshot,
  useDebounce,
  useObject
}

const inMemStorage = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()
const descendantListenerKeysByPrefix = new Map<string, Set<string>>()
const virtualRevisions = new Map<string, number>()

const store = new KVStore({
  inMemStorage,
  memoryOnly: false
})
const memoryStore = new KVStore({
  inMemStorage,
  memoryOnly: true
})

function testReset() {
  store.reset()
  memoryStore.reset()
}

function isVirtualKey(key: string) {
  return key.endsWith('.__juststore_keys') || key === '__juststore_keys'
}

// check if the value is a class instance
function isClass(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object') return false

  const proto = Object.getPrototypeOf(value)
  if (!proto || proto === Object.prototype || proto === Array.prototype) return false

  const descriptors = Object.getOwnPropertyDescriptors(proto)
  for (const key in descriptors) {
    if (descriptors[key]?.get) return true
  }
  return false
}

function isRecord(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object') return false
  return !Array.isArray(value) && !isClass(value)
}

/** Compare two values for equality
 * @description
 * - react-fast-compare for non-class instances
 * - reference equality for class instances
 * @param a - The first value to compare
 * @param b - The second value to compare
 * @returns True if the values are equal, false otherwise
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isClass(a) || isClass(b)) return a === b
  return rfcIsEqual(a, b)
}

/**
 * Extracts the root namespace from a full key.
 *
 * @param key - Full key string
 * @returns Namespace
 * @example
 * getNamespace('app.user.name') // 'app'
 */
function getNamespace(key: string): string {
  const index = key.indexOf('.')
  if (index === -1) return key
  return key.slice(0, index)
}

/**
 * Joins a namespace and path into a full key string.
 *
 * @param namespace - The store namespace (root key)
 * @param path - Optional dot-separated path within the namespace
 * @returns Combined key string (e.g., "app.user.name")
 */
function joinPath(namespace: string, path?: string): string {
  if (!path) return namespace
  return `${namespace}.${path}`
}

function joinChildKey(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child
}

function getKeyPrefixes(key: string): string[] {
  const dot = key.indexOf('.')
  if (dot === -1) return []

  const [first, ...parts] = key.split('.')
  if (parts.length === 0) return []

  const prefixes: string[] = []
  let current = first
  for (let i = 1; i < parts.length - 1; i++) {
    current += `.${parts[i]}`
    prefixes.push(current)
  }
  prefixes.unshift(first)
  return prefixes
}

/** Snapshot getter used by React's useSyncExternalStore. */
function getSnapshot(key: string, memoryOnly: boolean) {
  if (isVirtualKey(key)) {
    return virtualRevisions.get(key) ?? 0
  }
  if (memoryOnly) {
    return memoryStore.get(key)
  } else {
    return store.get(key)
  }
}

/** Updates the snapshot of a key. */
function updateSnapshot(key: string, value: unknown, memoryOnly: boolean) {
  if (memoryOnly) {
    memoryStore.set(key, value)
  } else {
    store.set(key, value)
  }
}

// Path traversal utilities
/** Get a nested value from an object/array using a dot-separated path. */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!path) return obj
  const segments = path.split('.')
  let current = obj

  // Array indices must be explicit non-negative integers.
  // IMPORTANT: treat empty string ("") as a *key*, not index 0.
  // (Number('') === 0 would otherwise turn paths like `foo.bar.` into `foo.bar.0`.)
  const parseArrayIndex = (segment: string) => {
    if (!/^(0|[1-9]\d*)$/.test(segment)) return null
    return Number(segment)
  }

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined

    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment)
      if (index === null) return undefined
      current = current[index]
    } else {
      current = (current as Record<string, unknown>)[segment]
    }
  }

  return current
}

/**
 * Immutably sets or deletes a nested value using a dot-separated path.
 *
 * Creates intermediate objects or arrays as needed based on whether the next
 * path segment is numeric. When value is undefined, the key is deleted from
 * objects or the index is spliced from arrays.
 *
 * @param obj - The root object to update
 * @param path - Dot-separated path to the target location
 * @param value - The value to set, or undefined to delete
 * @returns A new root object with the change applied
 */
function setNestedValue(obj: unknown, path: string, value: unknown): unknown {
  if (!path) return value

  const segments = path.split('.')
  if (obj !== null && obj !== undefined && typeof obj !== 'object') {
    return obj
  }

  // Array indices must be explicit non-negative integers.
  // IMPORTANT: treat empty string ("") as a *key*, not index 0.
  const parseArrayIndex = (segment: string) => {
    if (!/^(0|[1-9]\d*)$/.test(segment)) return null
    return Number(segment)
  }

  const result: Record<string, unknown> | unknown[] =
    obj === null || obj === undefined
      ? {}
      : Array.isArray(obj)
        ? [...obj]
        : (() => {
            const existing = obj as Record<string, unknown>
            const next = { ...existing }
            const order = getExternalKeyOrder(existing)
            if (order) setExternalKeyOrder(next, order)
            return next
          })()

  let current: Record<string, unknown> | unknown[] = result

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!
    const nextSegment = segments[i + 1]!
    const isNextIndex = parseArrayIndex(nextSegment) !== null

    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment)
      if (index === null) break

      const existing = current[index]
      let next: Record<string, unknown> | unknown[]
      if (existing === null || existing === undefined) {
        next = isNextIndex ? [] : {}
      } else if (typeof existing !== 'object') {
        next = isNextIndex ? [] : {}
      } else if (Array.isArray(existing)) {
        next = [...existing]
      } else {
        next = { ...(existing as Record<string, unknown>) }
      }
      current[index] = next
      current = next
    } else if (typeof current === 'object' && current !== null) {
      const currentObj = current as Record<string, unknown>
      const existing = currentObj[segment]
      let next: Record<string, unknown> | unknown[]
      if (existing === null || existing === undefined) {
        next = isNextIndex ? [] : {}
      } else if (typeof existing !== 'object') {
        next = isNextIndex ? [] : {}
      } else if (Array.isArray(existing)) {
        next = [...existing]
      } else {
        const existingObj = existing as Record<string, unknown>
        next = { ...existingObj }
        const order = getExternalKeyOrder(existingObj)
        if (order) setExternalKeyOrder(next, order)
      }
      currentObj[segment] = next
      current = next
    }
  }

  const lastSegment = segments[segments.length - 1]!
  if (Array.isArray(current)) {
    const index = parseArrayIndex(lastSegment)
    if (index !== null) {
      if (value === undefined) {
        current.splice(index, 1)
      } else {
        current[index] = value
      }
    }
  } else if (typeof current === 'object' && current !== null) {
    const currentObj = current as Record<string, unknown>
    const hadKey = Object.hasOwn(currentObj, lastSegment)
    if (value === undefined) {
      delete currentObj[lastSegment]
      if (hadKey) {
        const order = getExternalKeyOrder(currentObj)
        if (order)
          setExternalKeyOrder(
            currentObj,
            order.filter(k => k !== lastSegment)
          )
      }
    } else {
      currentObj[lastSegment] = value
      if (!hadKey) {
        const order = getExternalKeyOrder(currentObj)
        if (order) setExternalKeyOrder(currentObj, [...order, lastSegment])
      }
    }
  }

  return result
}

/**
 * Notifies all relevant listeners when a value changes.
 *
 * Handles three types of listeners:
 * 1. Exact match - listeners subscribed to the exact changed path
 * 2. Root listeners - listeners on the namespace root (for full-store subscriptions)
 * 3. Child listeners - listeners on nested paths that may be affected by the change
 *
 * Child listeners are only notified if their specific value actually changed,
 * determined by deep equality comparison.
 */
function notifyListeners(
  key: string,
  oldValue: unknown,
  newValue: unknown,
  { skipRoot = false, skipChildren = false, forceNotify = false } = {}
) {
  // Keep `state.xxx.keys()` in sync: any mutation under a path can change the set of
  // keys for that path (or its ancestors). Keys are represented as virtual nodes at
  // `${path}.__juststore_keys`, so we bump those virtual nodes here.
  //
  // Important: avoid recursion when *we* are notifying a virtual key.
  if (!isVirtualKey(key)) {
    const paths = [...getKeyPrefixes(key), key]
    for (const p of paths) {
      const virtualKey = joinChildKey(p, '__juststore_keys')
      const listenerSet = listeners.get(virtualKey)
      if (listenerSet && listenerSet.size > 0) {
        // Only notify the virtual key subscribers; the current call will handle
        // ancestors/children for the real key.
        notifyVirtualKey(virtualKey)
      }
    }
  }

  if (skipRoot && skipChildren) {
    if (!forceNotify && isEqual(oldValue, newValue)) {
      return
    }
    // exact match only
    const listenerSet = listeners.get(key)
    if (listenerSet) {
      listenerSet.forEach(listener => {
        listener()
      })
    }
    return
  }

  // Exact key match
  const exactSet = listeners.get(key)
  if (exactSet) {
    exactSet.forEach(listener => {
      listener()
    })
  }

  // Ancestor keys match (including namespace root)
  if (!skipRoot) {
    const namespace = getNamespace(key)
    const rootSet = listeners.get(namespace)
    if (rootSet) {
      rootSet.forEach(listener => {
        listener()
      })
    }

    // Also notify intermediate ancestors
    const prefixes = getKeyPrefixes(key)
    for (const prefix of prefixes) {
      if (prefix === namespace) continue // Already handled
      const prefixSet = listeners.get(prefix)
      if (prefixSet) {
        prefixSet.forEach(listener => {
          listener()
        })
      }
    }
  }

  // Child key match - check if value actually changed
  if (!skipChildren) {
    const childKeys = descendantListenerKeysByPrefix.get(key)
    if (childKeys) {
      for (const childKey of childKeys) {
        if (isVirtualKey(childKey)) {
          const childPath = childKey.slice(key.length + 1)
          const suffix = '.__juststore_keys'
          const objectPath = childPath.endsWith(suffix) ? childPath.slice(0, -suffix.length) : ''

          const getKeys = (root: unknown) => {
            const obj = objectPath ? getNestedValue(root, objectPath) : root
            return getStableKeys(obj)
          }

          const oldKeys = getKeys(oldValue)
          const newKeys = getKeys(newValue)

          if (forceNotify || !isEqual(oldKeys, newKeys)) {
            notifyVirtualKey(childKey)
          }
          continue
        }

        const childPath = childKey.slice(key.length + 1)
        const oldChildValue = getNestedValue(oldValue, childPath)
        const newChildValue = getNestedValue(newValue, childPath)

        if (forceNotify || !isEqual(oldChildValue, newChildValue)) {
          const childSet = listeners.get(childKey)
          if (childSet) {
            childSet.forEach(listener => {
              listener()
            })
          }
        }
      }
    }
  }
}

function notifyVirtualKey(key: string) {
  virtualRevisions.set(key, (virtualRevisions.get(key) ?? 0) + 1)
  notifyListeners(key, undefined, undefined, {
    skipRoot: true,
    skipChildren: true,
    forceNotify: true
  })
}

/**
 * Subscribes to changes for a specific key.
 *
 * @param key - The full key path to subscribe to
 * @param listener - Callback invoked when the value changes
 * @returns An unsubscribe function to remove the listener
 */
function subscribe(key: string, listener: () => void) {
  if (!listeners.has(key)) {
    listeners.set(key, new Set())
  }
  listeners.get(key)?.add(listener)

  const prefixes = getKeyPrefixes(key)
  for (const prefix of prefixes) {
    if (!descendantListenerKeysByPrefix.has(prefix)) {
      descendantListenerKeysByPrefix.set(prefix, new Set())
    }
    descendantListenerKeysByPrefix.get(prefix)?.add(key)
  }

  return () => {
    const keyListeners = listeners.get(key)
    if (keyListeners) {
      keyListeners.delete(listener)
      if (keyListeners.size === 0) {
        listeners.delete(key)

        for (const prefix of prefixes) {
          const prefixKeys = descendantListenerKeysByPrefix.get(prefix)
          if (prefixKeys) {
            prefixKeys.delete(key)
            if (prefixKeys.size === 0) {
              descendantListenerKeysByPrefix.delete(prefix)
            }
          }
        }
      }
    }
  }
}

/**
 * Core mutation function that updates the store and notifies listeners.
 *
 * Handles both setting and deleting values, with optimizations to skip
 * unnecessary updates when the value hasn't changed.
 *
 * @param key - The full key path to update
 * @param value - The new value, or undefined to delete
 * @param skipUpdate - When true, skips notifying listeners
 * @param memoryOnly - When true, skips localStorage persistence
 */
function produce(key: string, value: unknown, skipUpdate: boolean, memoryOnly: boolean) {
  if (skipUpdate) {
    updateSnapshot(key, value, memoryOnly)
    return
  }

  const current = getSnapshot(key, memoryOnly)

  if (isEqual(current, value)) return
  updateSnapshot(key, value, memoryOnly)

  // Notify listeners hierarchically with old and new values
  notifyListeners(key, current, value)
}

/**
 * Renames a key in an object.
 *
 * It trigger updates to
 *
 *  - listeners to `path` (key is updated)
 *  - listeners to `path.oldKey` (deleted)
 *  - listeners to `path.newKey` (created)
 *
 * @param path - The full key path to rename
 * @param oldKey - The old key to rename
 * @param newKey - The new key to rename to
 */
function rename(path: string, oldKey: string, newKey: string, memoryOnly: boolean) {
  const current = getSnapshot(path, memoryOnly)
  if (current === undefined || current === null || typeof current !== 'object') {
    // assign a new object with the new key
    const next = { [newKey]: undefined }
    updateSnapshot(path, next, memoryOnly)
    setExternalKeyOrder(next, [newKey])
    notifyListeners(path, current, next)
    return
  }

  const obj = current as Record<string, unknown>
  if (oldKey === newKey) return
  if (!Object.hasOwn(obj, oldKey)) return

  const keyOrder = getStableKeys(obj)
  const entries: [string, unknown][] = []

  for (const key of keyOrder) {
    if (!Object.hasOwn(obj, key)) continue
    if (key === oldKey) {
      entries.push([newKey, obj[oldKey]])
      continue
    }
    entries.push([key, obj[key]])
  }

  const newObject = Object.fromEntries(entries)
  updateSnapshot(path, newObject, memoryOnly)
  setExternalKeyOrder(newObject, Array.from(new Set(entries.map(([k]) => k))))
  notifyListeners(path, current, newObject)
}

/**
 * React hook that subscribes to and reads a value at a path.
 *
 * Uses useSyncExternalStore for tear-free reads and automatic re-rendering
 * when the subscribed value changes.
 *
 * @param key - The namespace or full key
 * @param path - Optional path within the namespace
 * @param memoryOnly - When true, skips localStorage persistence
 * @returns The current value at the path, or undefined if not set
 */
function useObject<T extends FieldValues, P extends FieldPath<T>>(
  key: string,
  path: P | undefined,
  memoryOnly: boolean
) {
  const fullKey = joinPath(key, path)
  const value = useSyncExternalStore(
    listener => subscribe(fullKey, listener),
    () => getSnapshot(fullKey, memoryOnly),
    () => getSnapshot(fullKey, memoryOnly)
  )

  return value as FieldPathValue<T, P> | undefined
}

/**
 * React hook that subscribes to a value with debounced updates.
 *
 * The returned value only updates after the specified delay has passed
 * since the last change, useful for expensive operations like search.
 *
 * @param key - The namespace or full key
 * @param path - Path within the namespace
 * @param delay - Debounce delay in milliseconds
 * @param memoryOnly - When true, skips localStorage persistence
 * @returns The debounced value at the path
 */
function useDebounce<T extends FieldValues, P extends FieldPath<T>>(
  key: string,
  path: P,
  delay: number,
  memoryOnly: boolean
): FieldPathValue<T, P> | undefined {
  const fullKey = joinPath(key, path)
  const currentValue = useSyncExternalStore(
    listener => subscribe(fullKey, listener),
    () => getSnapshot(fullKey, memoryOnly),
    () => getSnapshot(fullKey, memoryOnly)
  ) as FieldPathValue<T, P>

  const [debouncedValue, setDebouncedValue] = useState(currentValue)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      if (!isEqual(debouncedValue, currentValue)) {
        setDebouncedValue(currentValue)
      }
    }, delay)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [currentValue, delay, debouncedValue])

  return debouncedValue as FieldPathValue<T, P> | undefined
}

/**
 * Sets a value at a specific path within a namespace.
 *
 * @param key - The namespace
 * @param path - Path within the namespace
 * @param value - The value to set, or undefined to delete
 * @param skipUpdate - When true, skips notifying listeners
 * @param memoryOnly - When true, skips localStorage persistence
 */
function setLeaf<T extends FieldValues, P extends FieldPath<T>>(
  key: string,
  path: P,
  value: FieldPathValue<T, P> | undefined,
  skipUpdate = false,
  memoryOnly = false
) {
  const fullKey = joinPath(key, path)
  produce(fullKey, value, skipUpdate, memoryOnly)
}

// BroadcastChannel for cross-tab synchronization
const broadcastChannel = typeof window !== 'undefined' ? new BroadcastChannel('juststore') : null

// Cross-tab synchronization: keep memoryStore in sync with BroadcastChannel events
if (broadcastChannel) {
  store.setBroadcastChannel(broadcastChannel)
  memoryStore.setBroadcastChannel(broadcastChannel)

  broadcastChannel.addEventListener('message', event => {
    const { type, key, value } = event.data
    if (!key) return

    // Store old value before updating
    const oldRootValue = memoryStore.get(key)

    if (type === 'delete') {
      memoryStore.delete(key)
    } else if (type === 'set') {
      memoryStore.set(key, value)
    }

    // Notify all listeners that might be affected by this root key change
    const newRootValue = type === 'delete' ? undefined : value
    notifyListeners(key, oldRootValue, newRootValue)
  })
}

// Debug helpers (dev only)
/** Development-only debug helpers exposed on window.__pc_debug in development. */
const __pc_debug = {
  getStoreSize: () => store.size,
  getListenerSize: () => listeners.size,
  getStore: () => memoryStore,
  getStoreValue: (key: string) => memoryStore.get(key),
  getListeners: () => listeners
}

// Expose debug in browser for quick inspection during development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  ;(window as unknown as { __pc_debug: typeof __pc_debug }).__pc_debug = __pc_debug
}
