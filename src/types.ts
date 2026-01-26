import type { FieldPath, FieldPathValue, FieldValues, IsEqual } from './path'

export type {
  AllowedKeys,
  ArrayProxy,
  ArrayState,
  DerivedStateProps,
  IsNullable,
  MaybeNullable,
  ObjectMutationMethods,
  ObjectState,
  Prettify,
  ReadOnlyState,
  State,
  StoreRenderProps,
  StoreRoot,
  StoreSetStateValue,
  StoreShowProps,
  StoreUseComputeFn,
  StoreUseState,
  ValueState
}

type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

type AllowedKeys<T> = Exclude<keyof T, keyof ValueState<unknown> | keyof ObjectMutationMethods>

type ArrayMutationMethods<T> = Prettify<
  Pick<
    Array<T>,
    'push' | 'pop' | 'shift' | 'unshift' | 'splice' | 'reverse' | 'sort' | 'fill' | 'copyWithin'
  >
>

/** Type for array proxy with index access */
type ArrayProxy<T, ElementState = State<T>> = ArrayMutationMethods<T> & {
  /** Read without subscribing. Returns array or undefined for missing paths. */
  readonly value: T[]
  /**
   * Length of the underlying array. Runtime may return undefined when the
   * current value is not an array at the path. Prefer `Array.isArray(x) && x.length` when unsure.
   */
  readonly length: number
  /** Subscribe to array length changes without subscribing to individual element changes. */
  useLength(): number
  /** Numeric index access never returns undefined at the type level because
   * the proxy always returns another proxy object, even if the underlying value doesn't exist.
   */
  [K: number]: ElementState
  /** Safe accessor that never returns undefined at the type level */
  at(index: number): ElementState
  /** Insert items into the array in sorted order using the provided comparison function. */
  sortedInsert(cmp: (a: T, b: T) => number, ...items: T[]): number
}

type ObjectProxy<T extends FieldValues> = {
  /** Virtual state for the object's keys.
   *
   * This does NOT read from a real `keys` property on the stored object; it results in a stable array of keys.
   */
  readonly keys: ReadOnlyState<FieldPath<T>[]>
} & {
  [K in keyof T]-?: State<T[K]>
}

type ObjectMutationMethods = {
  /** Rename a key in an object. */
  rename: (oldKey: string, newKey: string) => void
}

/** Tuple returned by Store.use(path). */
type StoreUseState<T> = Readonly<[T, (value: StoreSetStateValue<T>, skipUpdate?: boolean) => void]>

/** Value type for set method. */
type StoreSetStateValue<T> = T | ((prev: T) => T)

/** Public API returned by createStore(namespace, defaultValue). */
type StoreRoot<T extends FieldValues> = {
  /** Get the state object for a path. */
  state: <P extends FieldPath<T>>(path: P) => State<FieldPathValue<T, P>>
  /** Subscribe and read the value at path. Re-renders when the value changes. */
  use: <P extends FieldPath<T>>(path: P) => FieldPathValue<T, P>
  /** Subscribe and read the debounced value at path. Re-renders when the value changes. */
  useDebounce: <P extends FieldPath<T>>(path: P, delay: number) => FieldPathValue<T, P>
  /** Convenience hook returning [value, setValue] for the path. */
  useState: <P extends FieldPath<T>>(path: P) => StoreUseState<FieldPathValue<T, P>>
  /** Read without subscribing. */
  value: <P extends FieldPath<T>>(path: P) => FieldPathValue<T, P>
  /** Set value at path (creates intermediate nodes as needed). */
  set: <P extends FieldPath<T>>(
    path: P,
    value: StoreSetStateValue<FieldPathValue<T, P>>,
    skipUpdate?: boolean
  ) => void
  /** Delete value at path (for arrays, removes index; for objects, deletes key). */
  reset: <P extends FieldPath<T>>(path: P) => void
  /** Rename a key in an object. */
  rename: <P extends FieldPath<T>>(path: P, oldKey: string, newKey: string) => void
  /** Subscribe to changes at path and invoke listener with the new value
   *
   * @returns A function to unsubscribe from the path.
   */
  subscribe: <P extends FieldPath<T>>(
    path: P,
    listener: (value: FieldPathValue<T, P>) => void
  ) => () => void
  /** Compute a derived value from the current value, similar to useState + useMemo */
  useCompute: <P extends FieldPath<T>, R>(
    path: P,
    fn: StoreUseComputeFn<T, P, R>,
    deps?: readonly unknown[]
  ) => R
  /** Notify listeners at path. */
  notify: <P extends FieldPath<T>>(path: P) => void

  /** Render-prop helper for inline usage. */
  Render: <P extends FieldPath<T>>(
    props: FieldPathValue<T, P> extends undefined ? never : StoreRenderProps<T, P>
  ) => React.ReactNode
  /** Show or hide children based on the value at the path. */
  Show: <P extends FieldPath<T>>(
    props: FieldPathValue<T, P> extends undefined ? never : StoreShowProps<T, P>
  ) => React.ReactNode
}

/** Common methods available on any deep proxy node */
type ValueState<T> = {
  /** Read without subscribing. */
  readonly value: T
  /** The field name for the proxy. */
  readonly field: string
  /** Subscribe and read the value at path. Re-renders when the value changes. */
  use(): T
  /** Subscribe and read the debounced value at path. Re-renders when the value changes. */
  useDebounce(delay: number): T
  /** Convenience hook returning [value, setValue] for the path. */
  useState(): StoreUseState<T>
  /** Set value at path (creates intermediate nodes as needed). */
  set(value: T | ((prev: T) => T), skipUpdate?: boolean): void
  /** Delete value at path (for arrays, removes index; for objects, deletes key). */
  reset(): void
  /** Subscribe to changes at path and invoke listener with the new value.
   *
   * @returns A function to unsubscribe.
   * @example
   *
   * useEffect(() => {
   *   const unsubscribe = store.a.b.c.subscribe(value => {
   *     console.log(value)
   *   })
   *   return unsubscribe
   * }, [])
   */
  subscribe(listener: (value: T) => void): () => void
  /** Compute a derived value from the current value, similar to useState + useMemo */
  useCompute: <R>(fn: (value: T) => R, deps?: readonly unknown[]) => R
  /** Ensure the value is an array. */
  ensureArray(): NonNullable<T> extends (infer U)[] ? ArrayState<U> : never
  /** Ensure the value is an object. */
  ensureObject(): NonNullable<T> extends FieldValues ? ObjectState<NonNullable<T>> : never
  /** Return a new state with a default value, and make the type non-nullable */
  withDefault(defaultValue: T): State<NonNullable<T>>
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
  derived: <R>({ from, to }: DerivedStateProps<T, R>) => State<R>
  /** Notify listener of current value. */
  notify(): void
  /** Render-prop helper for inline usage.
   *
   * @example
   * <store.a.b.c.Render>
   *   {(value, update) => <button onClick={() => update('new value')}>{value}</button>}
   * </store.a.b.c.Render>
   */
  Render: (props: {
    children: (value: T, update: (value: T) => void) => React.ReactNode
  }) => React.ReactNode
  /** Show or hide children based on the value at the path.
   *
   * @example
   * <store.a.b.c.Show on={value => value === 'show'}>
   *   <div>Show</div>
   * </store.a.b.c.Show>
   */
  Show: (props: { children: React.ReactNode; on: (value: T) => boolean }) => React.ReactNode
}

/**
 * A read-only state that provides access to the value, use, Render, and Show methods.
 */
type ReadOnlyState<T> = Prettify<
  Pick<ValueState<Readonly<Required<T>>>, 'value' | 'use' | 'useCompute' | 'Render' | 'Show'>
>

type MaybeNullable<T, Nullable extends boolean = false> = Nullable extends true ? T | undefined : T
type IsNullable<T> = T extends undefined | null ? true : false

type State<T> =
  IsEqual<T, unknown> extends true
    ? never
    : [NonNullable<T>] extends [readonly (infer U)[]]
      ? ArrayState<U, IsNullable<T>>
      : [NonNullable<T>] extends [FieldValues]
        ? ObjectState<NonNullable<T>, IsNullable<T>>
        : ValueState<T>

type ArrayState<T, Nullable extends boolean = false> =
  IsEqual<T, unknown> extends true
    ? never
    : ValueState<MaybeNullable<T[], Nullable>> & ArrayProxy<T>

type ObjectState<T extends FieldValues, Nullable extends boolean = false> = ObjectProxy<T> &
  ValueState<MaybeNullable<T, Nullable>> &
  ObjectMutationMethods

/** Type for useCompute function. */
type StoreUseComputeFn<T extends FieldValues, P extends FieldPath<T>, R> = (
  value: FieldPathValue<T, P>
) => R

/** Props for Store.Render helper. */
type StoreRenderProps<T extends FieldValues, P extends FieldPath<T>> = {
  path: P
  children: (
    value: FieldPathValue<T, P>,
    update: (value: StoreSetStateValue<FieldPathValue<T, P>>) => void
  ) => React.ReactNode
}

/** Props for Store.Show helper. */
type StoreShowProps<T extends FieldValues, P extends FieldPath<T>> = {
  path: P
  children: React.ReactNode
  on: (value: FieldPathValue<T, P>) => boolean
}

type DerivedStateProps<T, R> = {
  from?: (value: T) => R
  to?: (value: R) => T
}
