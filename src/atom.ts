import { useSyncExternalStore } from 'react'
import { getSnapshot, updateSnapshot } from './impl'

export { createAtom, type Atom }

/**
 * An atom is a value that can be subscribed to and updated.
 *
 * @param T - The type of the value
 * @returns The atom
 */
type Atom<T> = {
  /** The current value. */
  readonly value: T
  /** Subscribe to the value. */
  use: () => T
  /** Set the value. */
  set: (value: T) => void
  /** Reset the value to the default value. */
  reset: () => void
  /** Subscribe to the value.with a callback function. */
  subscribe: (listener: (value: T) => void) => () => void
  /** Render the value. */
  Render: ({
    children
  }: {
    children: (value: T, setValue: (value: T) => void) => React.ReactNode
  }) => React.ReactNode
}

/**
 * Creates an atom with a given id and default value.
 *
 * @param id - The id of the atom
 * @param defaultValue - The default value of the atom
 * @returns The atom
 * @example
 * const stateA = createAtom(useId(), false)
 * return (
 *   <>
 *    <ComponentA/>
 *     <ComponentB/>
 *      <stateA.Render>
 *        {(value, setValue) => (
 *          <button onClick={() => setValue(!value)}>{value ? 'Hide' : 'Show'}</button>
 *        )}
 *      </stateA.Render>
 *    <ComponentC/>
 *    <ComponentD/>
 *   </>
 * )
 */
function createAtom<T>(id: string, defaultValue: T, persistent = false): Atom<T> {
  const key = `atom:${id}`
  const memoryOnly = !persistent

  // set the default value
  // so getAtom will never return undefined
  if (getAtom(key, memoryOnly) === undefined) {
    setAtom(key, defaultValue, memoryOnly)
  }

  const atomProxy = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      const cacheKey = `_${String(prop)}`
      if (cacheKey in target) {
        // return cached methods first
        return target[cacheKey]
      }
      if (prop === 'value') {
        return getAtom(key, memoryOnly)
      }
      if (prop === 'use') {
        return (target._use ??= () => useAtom(key, memoryOnly))
      }
      if (prop === 'set') {
        return (target._set ??= (value: T) => setAtom(key, value, memoryOnly))
      }
      if (prop === 'reset') {
        return (target._reset ??= () => setAtom(key, defaultValue, memoryOnly))
      }
      if (prop === 'subscribe') {
        return (target._subscribe ??= (listener: (value: T) => void) =>
          subscribeAtom(key, memoryOnly, listener))
      }
      if (prop === 'Render') {
        return (target._Render ??= ({
          children
        }: {
          children: (value: T, setValue: (value: T) => void) => React.ReactNode
        }) => children(useAtom(key, memoryOnly), (value: T) => setAtom(key, value, memoryOnly)))
      }
      return undefined
    }
  })
  return atomProxy as Atom<T>
}

/**
 * React hook that subscribes to and reads a value at a path.
 *
 * Uses useSyncExternalStore for tear-free reads and automatic re-rendering
 * when the subscribed value changes.
 *
 * @param key - The namespace
 * @param memoryOnly - When true, skips localStorage persistence
 * @returns The current value at the namespace, or the default value if not set
 */
function useAtom<T>(key: string, memoryOnly = true) {
  const value = useSyncExternalStore(
    listener => subscribeAtom(key, memoryOnly, listener),
    () => getSnapshot(key, memoryOnly),
    () => getSnapshot(key, memoryOnly)
  )
  return value as T
}

/**
 * Gets a value from an atom.
 *
 * @param key - The namespace
 * @returns The value, or the default value if not set
 */
function getAtom<T>(key: string, memoryOnly = true): T {
  return getSnapshot(key, memoryOnly) as T
}

/**
 * Sets a value at a specific path within a namespace.
 *
 * @param key - The namespace
 * @param value - The value to set
 * @param memoryOnly - When true, skips localStorage persistence
 */
function setAtom<T>(key: string, value: T, memoryOnly = true) {
  updateSnapshot(key, value, memoryOnly)
  notifyAtom(key)
}

const listeners = new Map<string, Set<() => void>>()

/**
 * Subscribes to changes for an atom.
 *
 * @param key - The full key path to subscribe to
 * @param listener - Callback invoked when the value changes
 * @returns An unsubscribe function to remove the listener
 */
function subscribeAtom<T>(key: string, memoryOnly: boolean, listener: (value: T) => void) {
  let listenerSet = listeners.get(key)
  if (!listenerSet) {
    listenerSet = new Set()
    listeners.set(key, listenerSet)
  }

  const atomListener = () => listener(getAtom(key, memoryOnly))
  listenerSet.add(atomListener)

  return () => {
    const keyListeners = listeners.get(key)
    if (keyListeners) {
      keyListeners.delete(atomListener)
      if (keyListeners.size === 0) {
        listeners.delete(key)
      }
    }
  }
}

/**
 * Notifies all listeners for an atom.
 *
 * @param namespace - The namespace
 */
function notifyAtom(namespace: string) {
  const listenerSet = listeners.get(namespace)
  if (!listenerSet) return
  for (const listener of listenerSet) {
    listener()
  }
}
