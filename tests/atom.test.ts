import { expect, test } from 'bun:test'
import { createAtom } from '../src'

test('atom.value', () => {
  const atom = createAtom('test', 'abc')
  expect(atom.value).toBe('abc')
})

// test('atom.use', () => {
//   const atom = createAtom('test', 'abc')
//   expect(atom.use()).toBe('abc')
// })

test('atom.set', () => {
  const atom = createAtom('test', 'abc')
  atom.set('def')
  expect(atom.value).toBe('def')
})

test('atom.reset', () => {
  const atom = createAtom('test', 'abc')
  atom.set('123')
  atom.reset()
  expect(atom.value).toBe('abc')
})

test('atom.subscribe', () => {
  const atom = createAtom('test', 'abc')
  let numTriggered = 0
  const unsubscribe = atom.subscribe(() => {
    numTriggered++
  })
  atom.set('def')
  atom.set('ghi')
  expect(numTriggered).toBe(2)
  unsubscribe()
  atom.set('jkl')
  expect(numTriggered).toBe(2)
})
