import { afterEach, expect, test } from 'bun:test'
import { createForm } from '../src/form'
import { getSnapshot, isRecord, produce, testReset } from '../src/impl'

afterEach(() => {
  testReset()
})

const formNamespace = 'test'

test('form.value', () => {
  const [form, unsubscribeFns] = createForm(formNamespace, { name: 'abc' })
  expect(typeof form.value).toBe('object')
  expect(isRecord(form.value)).toBe(true)
  expect(getSnapshot(formNamespace, true)).toEqual({ name: 'abc' })
  expect(form.value).toEqual({ name: 'abc' })
  expect(form.name.value).toBe('abc')

  unsubscribeFns.forEach(unsubscribe => unsubscribe())
})

// ... other form.* derives from createNode

test('form.error', () => {
  const [form, unsubscribeFns] = createForm(formNamespace, { name: 'abc' })
  expect(form.name.error).toBe(undefined)
  produce(`_juststore_form_errors.${formNamespace}.name`, 'Name is required', true, true)
  expect(form.name.error).toBe('Name is required')
  unsubscribeFns.forEach(unsubscribe => unsubscribe())
})

test('form.setError', () => {
  const [form, unsubscribeFns] = createForm(formNamespace, { name: 'abc' })
  form.name.setError('Name is required')
  expect(form.name.error).toBe('Name is required')
  unsubscribeFns.forEach(unsubscribe => unsubscribe())
})

test('form.handleSubmit validates current values before submit', () => {
  const [form, unsubscribeFns] = createForm(
    formNamespace,
    { name: '' },
    { name: { validate: 'not-empty' } }
  )
  let submitted: { name: string } | undefined

  form.handleSubmit(values => {
    submitted = values
  })({ preventDefault: () => undefined } as React.SyntheticEvent)

  expect(submitted).toBe(undefined)
  expect(form.name.error).toBe('Name is required')

  form.name.set('abc')
  form.handleSubmit(values => {
    submitted = values
  })({ preventDefault: () => undefined } as React.SyntheticEvent)

  expect(submitted).toEqual({ name: 'abc' })
  expect(form.name.error).toBe(undefined)
  unsubscribeFns.forEach(unsubscribe => unsubscribe())
})

test('form.handleSubmit clears stale manual errors before validating', () => {
  const [form, unsubscribeFns] = createForm(
    formNamespace,
    { username: 'wrong', password: 'correct' },
    {
      username: { validate: 'not-empty' },
      password: { validate: 'not-empty' }
    }
  )
  let submitted: { username: string; password: string } | undefined

  form.password.setError('Invalid credentials')
  form.username.set('correct')

  form.handleSubmit(values => {
    submitted = values
  })({ preventDefault: () => undefined } as React.SyntheticEvent)

  expect(submitted).toEqual({ username: 'correct', password: 'correct' })
  expect(form.password.error).toBe(undefined)
  unsubscribeFns.forEach(unsubscribe => unsubscribe())
})
