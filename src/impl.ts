import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import rfcIsEqual from 'react-fast-compare'
import { localStorageDelete, localStorageGet, localStorageSet } from './local_storage'
import type { FieldPath, FieldPathValue, FieldValues } from './path'

export {
  getNestedValue,
  getSnapshot,
  isClass,
  isEqual,
  joinPath,
  notifyListeners,
  produce,
  rename,
  setLeaf,
  useDebounce,
  useObject,
  useSubscribe
}

const memoryStore = new Map<string, unknown>()

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

/** Compare two values for equality
 * @description
 * - react-fast-compare for non-class instances
 * - reference equality for class instances
 * @param a - The first value to compare
 * @param b - The second value to compare
 * @returns True if the values are equal, false otherwise
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (isClass(a) || isClass(b)) return a === b
  return rfcIsEqual(a, b)
}

type KeyValueStore = {
  has: (key: string) => boolean
  get: (key: string) => unknown
  set: (key: string, value: unknown, memoryOnly?: boolean) => void
  delete: (key: string, memoryOnly?: boolean) => void
  readonly size: number
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
  return namespace + '.' + path
}

// Path traversal utilities
/** Get a nested value from an object/array using a dot-separated path. */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!path) return obj
  const segments = path.split('.')
  let current = obj

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined

    if (Array.isArray(current)) {
      const index = Number(segment)
      if (Number.isNaN(index)) return undefined
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

  const result: Record<string, unknown> | unknown[] =
    obj === null || obj === undefined
      ? {}
      : Array.isArray(obj)
        ? [...obj]
        : { ...(obj as Record<string, unknown>) }

  let current: Record<string, unknown> | unknown[] = result

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!
    const nextSegment = segments[i + 1]!
    const isNextIndex = !Number.isNaN(Number(nextSegment))

    if (Array.isArray(current)) {
      const index = Number(segment)
      if (Number.isNaN(index)) break

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
        next = { ...(existing as Record<string, unknown>) }
      }
      currentObj[segment] = next
      current = next
    }
  }

  const lastSegment = segments[segments.length - 1]!
  if (Array.isArray(current)) {
    const index = Number(lastSegment)
    if (!Number.isNaN(index)) {
      if (value === undefined) {
        current.splice(index, 1)
      } else {
        current[index] = value
      }
    }
  } else if (typeof current === 'object' && current !== null) {
    const currentObj = current as Record<string, unknown>
    if (value === undefined) {
      delete currentObj[lastSegment]
    } else {
      currentObj[lastSegment] = value
    }
  }

  return result
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
 * Extracts the namespace and path from a full key.
 *
 * @param key - Full key string
 * @returns [namespace, path]
 * @example
 * splitNSPath('app.user.name') // ['app', 'user.name']
 */
function splitNSPath(key: string): [string, string] {
  const index = key.indexOf('.')
  if (index === -1) return [key, '']
  return [key.slice(0, index), key.slice(index + 1)]
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
  if (skipRoot && skipChildren) {
    if (!forceNotify && isEqual(oldValue, newValue)) {
      return
    }
    // exact match only
    const listenerSet = listeners.get(key)
    if (listenerSet) {
      listenerSet.forEach(listener => listener())
    }
    return
  }

  const rootKey = skipRoot ? null : key.split('.').slice(0, 2).join('.')
  const keyPrefix = skipChildren ? null : key + '.'

  // Single pass: collect listeners to notify
  const listenersToNotify = new Set<() => void>()

  for (const [listenerKey, listenerSet] of listeners.entries()) {
    if (listenerKey === key) {
      // Exact key match
      listenerSet.forEach(listener => listenersToNotify.add(listener))
    } else if (rootKey && listenerKey === rootKey) {
      // Root key match
      listenerSet.forEach(listener => listenersToNotify.add(listener))
    } else if (keyPrefix && listenerKey.startsWith(keyPrefix)) {
      // Child key match - check if value actually changed
      const childPath = listenerKey.substring(key.length + 1)
      const oldChildValue = getNestedValue(oldValue, childPath)
      const newChildValue = getNestedValue(newValue, childPath)

      if (forceNotify || !isEqual(oldChildValue, newChildValue)) {
        listenerSet.forEach(listener => listenersToNotify.add(listener))
      }
    }
  }

  // Notify all collected listeners
  listenersToNotify.forEach(listener => listener())
}

function forceNotifyListeners(
  key: string,
  options: { skipRoot?: boolean; skipChildren?: boolean } = {}
) {
  notifyListeners(key, undefined, undefined, { ...options, forceNotify: true })
}

// BroadcastChannel for cross-tab synchronization
const broadcastChannel = typeof window !== 'undefined' ? new BroadcastChannel('juststore') : null

/**
 * Backing store providing in-memory data with localStorage persistence
 * and cross-tab synchronization. All operations are namespaced at the root key
 * (characters before the first dot).
 */
const store: KeyValueStore = {
  has(key: string) {
    const rootKey = getNamespace(key)
    return (
      memoryStore.has(rootKey) ||
      (typeof window !== 'undefined' && localStorageGet(rootKey) !== undefined)
    )
  },
  get(key: string) {
    const [rootKey, path] = splitNSPath(key)

    // Get root object from memory or localStorage
    let rootValue: unknown
    if (memoryStore.has(rootKey)) {
      rootValue = memoryStore.get(rootKey)
    } else if (typeof window !== 'undefined') {
      rootValue = localStorageGet(rootKey)
      if (rootValue !== undefined) {
        memoryStore.set(rootKey, rootValue)
      }
    }

    // If no path, return root value
    if (!path) return rootValue

    // Traverse to nested value
    return getNestedValue(rootValue, path)
  },
  set(key: string, value: unknown, memoryOnly = false) {
    if (value === undefined) {
      return this.delete(key, memoryOnly)
    }

    const [rootKey, path] = splitNSPath(key)

    let rootValue: unknown

    if (!path) {
      // Setting root value directly
      rootValue = value
    } else {
      // Setting nested value
      const currentRoot = memoryStore.get(rootKey) ?? localStorageGet(rootKey) ?? {}
      rootValue = setNestedValue(currentRoot, path, value)
    }

    // Update memory
    memoryStore.set(rootKey, rootValue)

    // Persist to localStorage (unless memoryOnly)
    if (!memoryOnly && typeof window !== 'undefined') {
      localStorageSet(rootKey, rootValue)

      // Broadcast change to other tabs
      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'set', key: rootKey, value: rootValue })
      }
    }
  },
  delete(key: string, memoryOnly = false) {
    const [rootKey, path] = splitNSPath(key)

    if (!path) {
      // Deleting root key
      memoryStore.delete(rootKey)
      if (!memoryOnly && typeof window !== 'undefined') {
        localStorageDelete(rootKey)
        if (broadcastChannel) {
          broadcastChannel.postMessage({ type: 'delete', key: rootKey })
        }
      }
    } else {
      // Deleting nested value
      const currentRoot = memoryStore.get(rootKey) ?? localStorageGet(rootKey)
      if (currentRoot !== undefined) {
        const updatedRoot = setNestedValue(currentRoot, path, undefined)
        memoryStore.set(rootKey, updatedRoot)

        if (!memoryOnly && typeof window !== 'undefined') {
          localStorageSet(rootKey, updatedRoot)
          if (broadcastChannel) {
            broadcastChannel.postMessage({ type: 'set', key: rootKey, value: updatedRoot })
          }
        }
      }
    }
  },
  get size() {
    return memoryStore.size
  }
}

/** Snapshot getter used by React's useSyncExternalStore. */
function getSnapshot(key: string) {
  return store.get(key)
}

// Cross-tab synchronization: keep memoryStore in sync with BroadcastChannel events
if (broadcastChannel) {
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

    for (const listenerKey of listeners.keys()) {
      if (listenerKey === key) {
        // Direct key match - notify with old and new values
        notifyListeners(listenerKey, oldRootValue, newRootValue)
      } else if (listenerKey.startsWith(key + '.')) {
        // Child key - check if its value actually changed
        const childPath = listenerKey.substring(key.length + 1)
        const oldChildValue = getNestedValue(oldRootValue, childPath)
        const newChildValue = getNestedValue(newRootValue, childPath)

        if (!isEqual(oldChildValue, newChildValue)) {
          const childListeners = listeners.get(listenerKey)
          childListeners?.forEach(listener => listener())
        }
      }
    }
  })
}

const listeners = new Map<string, Set<() => void>>()

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
  listeners.get(key)!.add(listener)

  return () => {
    const keyListeners = listeners.get(key)
    if (keyListeners) {
      keyListeners.delete(listener)
      if (keyListeners.size === 0) {
        listeners.delete(key)
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
function produce(key: string, value: unknown, skipUpdate = false, memoryOnly = false) {
  const current = store.get(key)

  if (isEqual(current, value)) return
  store.set(key, value, memoryOnly)

  if (skipUpdate) return

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
 * @param notifyObject - Whether to notify listeners to the object path
 */
function rename(path: string, oldKey: string, newKey: string, notifyObject = true) {
  const current = store.get(path)
  if (current === undefined || current === null || typeof current !== 'object') {
    // assign a new object with the new key
    store.set(path, { [newKey]: undefined })
    if (notifyObject) {
      forceNotifyListeners(path, { skipChildren: true })
    }
    return
  }

  const oldValue = (current as Record<string, unknown>)[oldKey]
  const newObject = { ...current, [oldKey]: undefined, [newKey]: oldValue }
  delete newObject[oldKey]
  store.set(path, newObject)
  if (oldValue !== undefined) {
    forceNotifyListeners(joinPath(path, oldKey))
  }
  forceNotifyListeners(joinPath(path, newKey))
  if (notifyObject) {
    forceNotifyListeners(path, { skipChildren: true })
  }
}

/**
 * React hook that subscribes to and reads a value at a path.
 *
 * Uses useSyncExternalStore for tear-free reads and automatic re-rendering
 * when the subscribed value changes.
 *
 * @param key - The namespace or full key
 * @param path - Optional path within the namespace
 * @returns The current value at the path, or undefined if not set
 */
function useObject<T extends FieldValues, P extends FieldPath<T>>(key: string, path?: P) {
  const fullKey = joinPath(key, path)
  const value = useSyncExternalStore(
    listener => subscribe(fullKey, listener),
    () => getSnapshot(fullKey),
    () => getSnapshot(fullKey)
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
 * @returns The debounced value at the path
 */
function useDebounce<T extends FieldValues, P extends FieldPath<T>>(
  key: string,
  path: P,
  delay: number
): FieldPathValue<T, P> | undefined {
  const fullKey = joinPath(key, path)
  const currentValue = useSyncExternalStore(
    listener => subscribe(fullKey, listener),
    () => getSnapshot(fullKey),
    () => getSnapshot(fullKey)
  ) as FieldPathValue<T, P> | undefined

  const [debouncedValue, setDebouncedValue] = useState<FieldPathValue<T, P> | undefined>(
    currentValue
  )
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
 * React hook for side effects when a value changes.
 *
 * Unlike `use()`, this doesn't cause re-renders. Instead, it calls the
 * provided callback whenever the value changes, useful for syncing with
 * external systems or triggering effects.
 *
 * @param key - The full key path to subscribe to
 * @param onChange - Callback invoked with the new value on each change
 */
function useSubscribe<T>(key: string, onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const unsubscribe = subscribe(key, () => {
      const value = getSnapshot(key) as T
      onChangeRef.current(value)
    })

    return unsubscribe
  }, [key])
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

// Debug helpers (dev only)
/** Development-only debug helpers exposed on window.__pc_debug in development. */
const __pc_debug = {
  getStoreSize: () => store.size,
  getListenerSize: () => listeners.size,
  getStore: () => memoryStore,
  getStoreValue: (key: string) => memoryStore.get(key)
}

// Expose debug in browser for quick inspection during development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  ;(window as unknown as { __pc_debug: typeof __pc_debug }).__pc_debug = __pc_debug
}
