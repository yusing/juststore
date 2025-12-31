import { getSnapshot, produce, rename } from '../src/impl'

import { expect, test } from 'bun:test'

const path = 'obj'

test('rename', () => {
  // ensure interger keys not being re-ordered
  const obj = { '1': 1, '2': 2, '3': 3 }
  produce(path, obj, false, true)
  rename(path, '2', '5')

  expect(Object.keys(getSnapshot(path) as Record<string, unknown>)).toEqual(['1', '5', '3'])
  expect(getSnapshot(path)).toEqual({ '1': 1, '5': 2, '3': 3 })
})
