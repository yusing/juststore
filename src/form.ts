/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { pascalCase } from 'change-case'
import { useId } from 'react'
import { getSnapshot, produce } from './impl'
import { createNode } from './node'
import type { FieldPath, FieldPathValue, FieldValues } from './path'
import { createStoreRoot } from './root'
import type { AllowedKeys, ArrayProxy, State, StoreRoot } from './types'

export {
  useForm,
  type CreateFormOptions,
  type DeepNonNullable,
  type FormArrayProxy,
  type FormDeepProxy,
  type FormState,
  type FormStore
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

type FormArrayProxy<T> = ArrayProxy<T> & FormCommon

type FormState<T> = State<T> & FormCommon

/** Type for nested objects with proxy methods */
type FormDeepProxy<T> =
  NonNullable<T> extends readonly (infer U)[]
    ? FormArrayProxy<U> & FormState<T>
    : NonNullable<T> extends FieldValues
      ? {
          [K in AllowedKeys<NonNullable<T>>]-?: NonNullable<NonNullable<T>[K]> extends object
            ? FormDeepProxy<NonNullable<T>[K]>
            : FormState<NonNullable<T>[K]>
        } & FormState<T>
      : FormState<T>

/** Type for nested objects with proxy methods */
type DeepNonNullable<T> =
  NonNullable<T> extends readonly (infer U)[]
    ? U[]
    : NonNullable<T> extends FieldValues
      ? {
          [K in keyof NonNullable<T>]-?: DeepNonNullable<NonNullable<T>[K]>
        }
      : NonNullable<T>

/**
 * The form store type, combining form state with validation and submission handling.
 */
type FormStore<T extends FieldValues> = FormDeepProxy<T> & {
  /** Clears all validation errors from the form. */
  clearErrors(): void
  /** Returns a form submit handler that validates and calls onSubmit with form values. */
  handleSubmit(onSubmit: (values: T) => void): (e: React.FormEvent) => void
}

type NoEmptyValidator = 'not-empty'
type RegexValidator = RegExp
type FunctionValidator<T extends FieldValues> = (
  value: FieldPathValue<T, FieldPath<T>> | undefined,
  state: FormStore<T>
) => string | undefined

type Validator<T extends FieldValues> = NoEmptyValidator | RegexValidator | FunctionValidator<T>

type FieldConfig<T extends FieldValues> = {
  validate?: Validator<T>
}

type CreateFormOptions<T extends FieldValues> = Partial<Record<FieldPath<T>, FieldConfig<T>>>

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
  const errorNamespace = `errors.${namespace}`

  const storeApi = createStoreRoot<T>(namespace, defaultValue, { memoryOnly: true })
  const errorStore = createStoreRoot<Record<string, string | undefined>>(
    errorNamespace,
    {},
    { memoryOnly: true }
  )

  const formStore = {
    clearErrors: () => produce(errorNamespace, undefined, false, true),
    handleSubmit: (onSubmit: (value: T) => void) => (e: React.FormEvent) => {
      e.preventDefault()
      // disable submit if there are errors
      if (Object.keys(getSnapshot(errorNamespace) ?? {}).length === 0) {
        onSubmit(getSnapshot(namespace) as T)
      }
    }
  }

  const store = new Proxy(storeApi, {
    get(_target, prop) {
      if (prop in formStore) {
        return formStore[prop as keyof typeof formStore]
      }
      if (prop in storeApi) {
        return storeApi[prop as keyof typeof storeApi]
      }
      if (typeof prop === 'string') {
        return createFormProxy(storeApi, errorStore, prop)
      }
      return undefined
    }
  }) as unknown as FormStore<T>

  for (const entry of Object.entries(fieldConfigs)) {
    const [path, config] = entry as [FieldPath<T>, FieldConfig<T>]
    const validator = getValidator(path, config?.validate)

    if (validator) {
      storeApi.subscribe(path, (value: FieldPathValue<T, FieldPath<T>>) => {
        const error = validator(value, store)
        if (!error) {
          errorStore.reset(path)
        } else {
          errorStore.set(path, error as any)
        }
      })
    }
  }

  return store
}

/**
 * Creates a form proxy node that extends the base node with error handling.
 *
 * @param storeApi - The form's value store
 * @param errorStore - The form's error store
 * @param path - The field path
 * @returns A proxy with both state methods and error methods
 */
const createFormProxy = (
  storeApi: StoreRoot<any>,
  errorStore: StoreRoot<Record<string, string | undefined>>,
  path: string
) => {
  const proxyCache = new Map<string, any>()

  const useError = () => errorStore.use(path)
  const getError = () => errorStore.value(path)
  const setError = (error: string | undefined) => {
    errorStore.set(path, error)
    return true
  }

  return createNode(storeApi, path, proxyCache, {
    useError: {
      get: () => useError
    },
    error: {
      get: getError
    },
    setError: {
      get: () => setError
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
