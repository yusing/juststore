import { getSnapshot, produce, rename } from '../src/impl'

import { expect, test } from 'bun:test'

const path = 'obj'

function get(): Record<string, unknown> {
  return getSnapshot(path) as Record<string, unknown>
}

test('rename', () => {
  // ensure interger keys not being re-ordered
  const obj = { a: 0, '1': 1, '2': 2, '3': 3, e: 4 }
  produce(path, obj, false, true)
  rename(path, '2', '5')

  expect(Object.keys(get())).toEqual(['a', '1', '5', '3', 'e'])
  expect(get()).toEqual({ a: 0, '1': 1, '5': 2, '3': 3, e: 4 })

  rename(path, '5', 'c')

  expect(Object.keys(get())).toEqual(['a', '1', 'c', '3', 'e'])
  expect(get()).toEqual({ a: 0, '1': 1, c: 2, '3': 3, e: 4 })

  rename(path, 'c', '2')

  expect(Object.keys(get())).toEqual(['a', '1', '2', '3', 'e'])
  expect(get()).toEqual({ a: 0, '1': 1, '2': 2, '3': 3, e: 4 })
})
