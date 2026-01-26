/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { pascalCase } from 'change-case'
import { useEffect, useId, useMemo } from 'react'
import { getSnapshot, produce } from './impl'
import { createNode } from './node'
import type { FieldPath, FieldPathValue, FieldValues, IsEqual } from './path'
import { createStoreRoot } from './root'
import type {
  ArrayProxy,
  DerivedStateProps,
  IsNullable,
  MaybeNullable,
  ObjectMutationMethods,
  StoreRoot,
  ValueState
} from './types'

export {
  createForm,
  useForm,
  type CreateFormOptions,
  type DeepNonNullable,
  type FormArrayState,
  type FormObjectState,
  type FormState,
  type FormStore,
  type FormValueState
}

/**
 * Common form field methods available on every form state node.
 */
type FormCommon = {
  /** Subscribe and read the validation error. Re-renders when the error changes. */
  useError: () => string | undefined
  /** Read the validation error without subscribing. */
  readonly error: string | undefined
  /** Manually set a validation error. */
  setError: (error: string | undefined) => void
}

type FormState<T> =
  IsEqual<T, unknown> extends true
    ? never
    : [NonNullable<T>] extends [readonly (infer U)[]]
      ? FormArrayState<U, IsNullable<T>>
      : [NonNullable<T>] extends [FieldValues]
        ? FormObjectState<NonNullable<T>, IsNullable<T>>
        : FormValueState<T>

interface FormValueState<T> extends Omit<ValueState<T>, 'withDefault' | 'derived'>, FormCommon {
  /** Return a new state with a default value, and make the type non-nullable */
  withDefault(defaultValue: T): FormState<NonNullable<T>>
  /** Virtual state derived from the current value.
   *
   * @returns ArrayState if the derived value is an array, ObjectState if the derived value is an object, otherwise State.
   * @example
   * const state = store.a.b.c.derived({
   *   from: value => value + 1,
   *   to: value => value - 1
   * })
   * state.use() // returns the derived value
   * state.set(10) // sets the derived value
   * state.reset() // resets the derived value
   */
  derived: <R>({ from, to }: DerivedStateProps<T, R>) => FormState<R>
}

type FormArrayState<T, Nullable extends boolean = false, TT = MaybeNullable<T[], Nullable>> =
  IsEqual<T, unknown> extends true ? never : FormValueState<TT[]> & ArrayProxy<TT, FormState<TT>>

type FormObjectState<T extends FieldValues, Nullable extends boolean = false> = {
  [K in keyof T]-?: FormState<T[K]>
} & FormValueState<MaybeNullable<T, Nullable>> &
  ObjectMutationMethods

/** Type for nested objects with proxy methods */
type DeepNonNullable<T> = [NonNullable<T>] extends [readonly (infer U)[]]
  ? U[]
  : [NonNullable<T>] extends [FieldValues]
    ? {
        [K in keyof NonNullable<T>]-?: DeepNonNullable<NonNullable<T>[K]>
      }
    : NonNullable<T>

/**
 * The form store type, combining form state with validation and submission handling.
 */
type FormStore<T extends FieldValues> = FormState<T> & {
  /** Clears all validation errors from the form. */
  clearErrors(): void
  /** Returns a form submit handler that validates and calls onSubmit with form values. */
  handleSubmit(onSubmit: (values: T) => void): (e: React.FormEvent) => void
}

type NoEmptyValidator = 'not-empty'
type RegexValidator = RegExp
type FunctionValidator<T extends FieldValues> = (
  value: FieldPathValue<T, FieldPath<T>>,
  state: FormStore<T>
) => string | undefined

type Validator<T extends FieldValues> = NoEmptyValidator | RegexValidator | FunctionValidator<T>

type FieldConfig<T extends FieldValues> = {
  validate?: Validator<T>
}

type CreateFormOptions<T extends FieldValues> = Partial<Record<FieldPath<T>, FieldConfig<T>>>

type UnsubscribeFn = () => void
type UnsubscribeFns = UnsubscribeFn[]

/**
 * React hook that creates a form store with validation support.
 *
 * The form store extends the memory store with error handling and validation.
 * Fields can be configured with validators that run on every change.
 *
 * @param defaultValue - Initial form values
 * @param fieldConfigs - Optional validation configuration per field
 * @returns A form store with validation and submission handling
 *
 * @example
 * const form = useForm(
 *   { email: '', password: '' },
 *   {
 *     email: { validate: 'not-empty' },
 *     password: { validate: v => v && v.length < 8 ? 'Too short' : undefined }
 *   }
 * )
 *
 * <form onSubmit={form.handleSubmit(values => console.log(values))}>
 *   <input value={form.email.use() ?? ''} onChange={e => form.email.set(e.target.value)} />
 *   {form.email.useError() && <span>{form.email.error}</span>}
 * </form>
 */
function useForm<T extends FieldValues>(
  defaultValue: T,
  fieldConfigs: CreateFormOptions<T> = {}
): FormStore<T> {
  const formId = useId()
  const namespace = `form:${formId}`
  const [form, unsubscribeFns] = useMemo(
    () => createForm(namespace, defaultValue, fieldConfigs),
    [namespace, defaultValue, fieldConfigs]
  )
  useEffect(() => {
    return () => {
      for (const unsubscribe of unsubscribeFns) {
        unsubscribe()
      }
    }
  }, [unsubscribeFns])
  return form
}

function createForm<T extends FieldValues>(
  namespace: string,
  defaultValue: T,
  fieldConfigs: CreateFormOptions<T> = {}
): [FormStore<T>, UnsubscribeFns] {
  const errorNamespace = `_juststore_form_errors.${namespace}`
  const errorStore = createStoreRoot<Record<string, string | undefined>>(
    errorNamespace,
    {},
    { memoryOnly: true }
  )

  const storeApi = createStoreRoot<T>(namespace, defaultValue, { memoryOnly: true })
  const formApi = {
    clearErrors: () => produce(errorNamespace, undefined, false, true),
    handleSubmit: (onSubmit: (value: T) => void) => (e: React.FormEvent) => {
      e.preventDefault()
      // disable submit if there are errors
      if (Object.keys(getSnapshot(errorNamespace, true) ?? {}).length === 0) {
        onSubmit(getSnapshot(namespace, true) as T)
      }
    }
  }

  const store = createFormProxy<T>(storeApi, errorStore) as unknown as FormStore<T>
  const proxy = new Proxy(formApi, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof typeof target]
      }
      return store[prop as keyof typeof store]
    }
  }) as FormStore<T>

  const unsubscribeFns: UnsubscribeFns = []
  for (const entry of Object.entries(fieldConfigs)) {
    const [path, config] = entry as [FieldPath<T>, FieldConfig<T>]
    const validator = getValidator(path, config?.validate)

    if (validator) {
      const unsubscribe = storeApi.subscribe(path, value => {
        const error = validator(value, store)
        if (!error) {
          errorStore.reset(path)
        } else {
          errorStore.set(path, error as any)
        }
      })
      unsubscribeFns.push(unsubscribe)
    }
  }

  return [proxy, unsubscribeFns]
}

/**
 * Creates a form proxy node that extends the base node with error handling.
 *
 * @param storeApi - The form's value store
 * @param errorStore - The form's error store
 * @param path - The field path
 * @returns A proxy with both state methods and error methods
 */
function createFormProxy<T extends FieldValues>(
  storeApi: StoreRoot<T>,
  errorStore: StoreRoot<Record<string, string | undefined>>
) {
  const proxyCache = new Map<string, any>()

  return createNode(storeApi, '', proxyCache, {
    useError: {
      get: (path: FieldPath<T>) => () => errorStore.use(path)
    },
    error: {
      get: (path: FieldPath<T>) => errorStore.value(path)
    },
    setError: {
      get: (path: FieldPath<T>) => (error: string | undefined) => {
        errorStore.set(path, error as any, false)
        return true
      }
    }
  })
}

/**
 * Converts a validator configuration into a validation function.
 *
 * @param field - The field path (used for error messages)
 * @param validator - The validator config ('not-empty', RegExp, or function)
 * @returns A validation function, or undefined if no validator provided
 */
function getValidator<T extends FieldValues>(
  field: FieldPath<T>,
  validator: Validator<T> | undefined
): FunctionValidator<T> | undefined {
  if (!validator) {
    return undefined
  }
  if (validator === 'not-empty') {
    return (value: FieldPathValue<T, FieldPath<T>> | undefined) => validateNoEmpty<T>(field, value)
  }
  if (validator instanceof RegExp) {
    return (value: FieldPathValue<T, FieldPath<T>> | undefined) =>
      validateRegex<T>(field, value, validator)
  }
  return validator
}

/**
 * Validates that a field has a non-empty value.
 *
 * @param field - The field path (used for error message)
 * @param value - The value to validate
 * @returns Error message if empty, undefined if valid
 */
function validateNoEmpty<T extends FieldValues>(
  field: FieldPath<T>,
  value: FieldPathValue<T, FieldPath<T>> | undefined
) {
  if (!stringValue(value)) {
    return `${pascalCase(field)} is required`
  }
  return undefined
}

/**
 * Validates that a field matches a regular expression.
 *
 * @param field - The field path (used for error message)
 * @param value - The value to validate
 * @param regex - The pattern to match against
 * @returns Error message if invalid, undefined if valid
 */
function validateRegex<T extends FieldValues>(
  field: FieldPath<T>,
  value: FieldPathValue<T, FieldPath<T>> | undefined,
  regex: RegExp
) {
  if (!regex.test(stringValue(value))) {
    return `${pascalCase(field)} is invalid`
  }
  return undefined
}

/**
 * Converts a value to a string for validation purposes.
 * Returns empty string for non-primitive values.
 */
function stringValue(v: any) {
  if (typeof v === 'string') {
    return v
  }
  if (typeof v === 'number') {
    return String(v)
  }
  if (typeof v === 'boolean') {
    return String(v)
  }
  return ''
}
