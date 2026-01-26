import { isRecord } from './impl'

export { getExternalKeyOrder, getStableKeys, setExternalKeyOrder }

const externalKeyOrder = new WeakMap<object, string[]>()

function getExternalKeyOrder(target: object): string[] | undefined {
  return externalKeyOrder.get(target)
}

function setExternalKeyOrder(target: object, keys: string[]) {
  externalKeyOrder.set(target, keys)
}

function getStableKeys(value: unknown): string[] {
  if (!isRecord(value)) return []
  const target = value as Record<string, unknown>
  const existing = externalKeyOrder.get(target as unknown as object)
  if (existing) {
    const next = existing.filter(k => Object.prototype.hasOwnProperty.call(target, k))
    const nextSet = new Set(next)
    for (const k of Object.keys(target)) {
      if (nextSet.has(k)) continue
      next.push(k)
    }
    if (next.length !== existing.length) {
      setExternalKeyOrder(target, next)
    }
    return next
  }

  const keys = Object.keys(target)
  setExternalKeyOrder(target, keys)
  return keys
}
