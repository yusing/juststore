import { afterEach, expect, test } from 'bun:test'
import { createMemoryStore } from '../src'
import { getSnapshot, isRecord, testReset } from '../src/impl'

afterEach(() => {
  testReset()
})

const memoryNamespace = 'test'

test('memory.value', () => {
  const store = createMemoryStore(memoryNamespace, { name: 'abc' })
  expect(typeof store.value).toBe('object')
  expect(isRecord(store.value)).toBe(true)
  expect(getSnapshot(memoryNamespace, true)).toEqual({ name: 'abc' })
  expect(store.value).toEqual({ name: 'abc' })
  expect(store.name.value).toBe('abc')
})

test('memory.set', () => {
  const store = createMemoryStore(memoryNamespace, { name: 'abc' })
  store.name.set('def')
  expect(store.name.value).toBe('def')
})

test('memory.reset', () => {
  const store = createMemoryStore(memoryNamespace, { name: 'abc' })
  store.name.set('def')
  store.name.reset()
  expect(store.name.value).toBe('abc')
})

test('memory.subscribe', () => {
  const store = createMemoryStore(memoryNamespace, { name: 'abc' })
  let numTriggered = 0
  const unsubscribe = store.name.subscribe(() => {
    numTriggered++
  })
  store.name.set('def')
  store.name.set('ghi')
  expect(numTriggered).toBe(2)
  unsubscribe()
  store.name.set('jkl')
  expect(numTriggered).toBe(2)
  unsubscribe()
})
