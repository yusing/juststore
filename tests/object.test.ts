import { afterEach, expect, test } from 'bun:test'
import { createStore } from '../src'
import {
  getSnapshot,
  getStableKeys,
  produce,
  rename,
  setExternalKeyOrder,
  testReset
} from '../src/impl'

afterEach(() => {
  testReset()
})

const path = 'obj'

function get(): Record<string, unknown> {
  return getSnapshot(path, true) as Record<string, unknown>
}

test('rename', () => {
  // ensure interger keys not being re-ordered
  const obj = { a: 0, '1': 1, '2': 2, '3': 3, e: 4 }
  setExternalKeyOrder(obj, ['a', '1', '2', '3', 'e'])
  produce(path, obj, false, true)
  rename(path, '2', '5', true)

  expect(getStableKeys(get())).toEqual(['a', '1', '5', '3', 'e'])
  expect(get()).toEqual({ a: 0, '1': 1, '5': 2, '3': 3, e: 4 })

  rename(path, '5', 'c', true)

  expect(getStableKeys(get())).toEqual(['a', '1', 'c', '3', 'e'])
  expect(get()).toEqual({ a: 0, '1': 1, c: 2, '3': 3, e: 4 })

  rename(path, 'c', '2', true)

  expect(getStableKeys(get())).toEqual(['a', '1', '2', '3', 'e'])
  expect(get()).toEqual({ a: 0, '1': 1, '2': 2, '3': 3, e: 4 })
})

test('empty segment in path is treated as object key, not array index', () => {
  // Repro for a common UI pattern: using '' as a temporary key for a new object entry.
  // This creates paths with a trailing dot (e.g. `providers.docker.`), and MUST NOT
  // be interpreted as index 0.
  const root = 'empty_segment'

  // Reset root snapshot (memoryOnly)
  produce(root, {}, false, true)

  // Set at nested path that includes an empty segment
  produce(`${root}.providers.docker.`, {}, false, true)

  const snapshot = getSnapshot(root, true) as Record<string, unknown>
  expect(snapshot).toEqual({ providers: { docker: { '': {} } } })
  expect(Array.isArray((snapshot as any).providers?.docker)).toBe(false)

  // Reading the same path should work
  expect(getSnapshot(`${root}.providers.docker.`, true)).toEqual({})
})

test('createStore deep merges nested defaults with existing persisted state', () => {
  produce(
    'homepage',
    {
      systemInfo: {
        uptime: 15782,
        cpuAverage: 3.15
      }
    },
    false,
    false
  )

  const store = createStore('homepage', {
    systemInfo: {
      uptime: 0,
      cpuAverage: 0,
      secondDriveOptions: [] as string[]
    }
  })

  expect(store.systemInfo.uptime.value).toBe(15782)
  expect(store.systemInfo.cpuAverage.value).toBe(3.15)
  expect(store.systemInfo.secondDriveOptions.value).toEqual([])
})
