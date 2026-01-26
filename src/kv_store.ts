import { getNestedValue, setNestedValue } from './impl'
import { localStorageDelete, localStorageGet, localStorageSet } from './local_storage'

export { getNestedValue, KVStore, setNestedValue, type KeyValueStore }

type KeyValueStore = {
  getBroadcastChannel: () => BroadcastChannel | undefined
  setBroadcastChannel: (broadcastChannel: BroadcastChannel) => void

  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  delete: (key: string) => void
  reset: () => void
  readonly size: number
}

type CreateKVStoreOptions = {
  inMemStorage: Map<string, unknown>
  broadcastChannel?: BroadcastChannel
  memoryOnly: boolean
}

class KVStore implements KeyValueStore {
  private inMemStorage: Map<string, unknown>
  private broadcastChannel?: BroadcastChannel
  private memoryOnly: boolean

  constructor(options: CreateKVStoreOptions) {
    this.inMemStorage = options.inMemStorage
    this.broadcastChannel = options.broadcastChannel
    this.memoryOnly = options.memoryOnly
  }

  getBroadcastChannel(): BroadcastChannel | undefined {
    return this.broadcastChannel
  }

  setBroadcastChannel(broadcastChannel: BroadcastChannel) {
    this.broadcastChannel = broadcastChannel
  }

  get(key: string) {
    const [rootKey, path] = splitNSPath(key)
    // Get root object from memory or localStorage
    let rootValue: unknown
    if (this.inMemStorage.has(rootKey)) {
      rootValue = this.inMemStorage.get(rootKey)
    } else if (!this.memoryOnly && typeof window !== 'undefined') {
      rootValue = localStorageGet(rootKey)
      if (rootValue !== undefined) {
        this.inMemStorage.set(rootKey, rootValue)
      }
    }

    // If no path, return root value
    if (!path) return rootValue

    // Traverse to nested value
    return getNestedValue(rootValue, path)
  }

  set(key: string, value: unknown) {
    if (value === undefined) {
      return this.delete(key)
    }

    const [rootKey, path] = splitNSPath(key)

    let rootValue: unknown

    if (!path) {
      // Setting root value directly
      rootValue = value
    } else {
      // Setting nested value
      const currentRoot = this.inMemStorage.get(rootKey) ?? localStorageGet(rootKey) ?? {}
      rootValue = setNestedValue(currentRoot, path, value)
    }

    // Update memory
    this.inMemStorage.set(rootKey, rootValue)

    // Persist to localStorage (unless memoryOnly)
    if (!this.memoryOnly && typeof window !== 'undefined') {
      localStorageSet(rootKey, rootValue)

      // Broadcast change to other tabs
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({ type: 'set', key: rootKey, value: rootValue })
      }
    }
  }

  delete(key: string) {
    const [rootKey, path] = splitNSPath(key)

    if (!path) {
      // Deleting root key
      this.inMemStorage.delete(rootKey)
      if (!this.memoryOnly && typeof window !== 'undefined') {
        localStorageDelete(rootKey)
        if (this.broadcastChannel) {
          this.broadcastChannel.postMessage({ type: 'delete', key: rootKey })
        }
      }
    } else {
      // Deleting nested value
      const currentRoot = this.inMemStorage.get(rootKey) ?? localStorageGet(rootKey)
      if (currentRoot !== undefined) {
        const updatedRoot = setNestedValue(currentRoot, path, undefined)
        this.inMemStorage.set(rootKey, updatedRoot)

        if (!this.memoryOnly && typeof window !== 'undefined') {
          localStorageSet(rootKey, updatedRoot)
          if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({ type: 'set', key: rootKey, value: updatedRoot })
          }
        }
      }
    }
  }

  reset() {
    if (!this.memoryOnly && typeof window !== 'undefined') {
      for (const key of this.inMemStorage.keys()) {
        localStorageDelete(key)
      }
    }
    this.inMemStorage.clear()
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: 'reset' })
    }
  }

  get size() {
    return this.inMemStorage.size
  }
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
