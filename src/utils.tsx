import { useCallback } from 'react'
import type { Atom } from './atom'
import type { StoreSetStateValue, ValueState } from './types'

export { Render, RenderWithUpdate, Conditional }

type AtomLike<T> = Pick<Atom<T> | ValueState<T>, 'use' | 'set' | 'value'>
type ReadOnlyAtomLike<T> = Pick<Atom<T> | ValueState<T>, 'use' | 'value'>

type RenderProps<State extends ReadOnlyAtomLike<unknown>> = {
  state: State
  children: (value: ReturnType<State['use']>) => React.ReactNode
}

type RenderWithUpdateProps<State extends AtomLike<unknown>> = {
  state: State
  children: (
    value: ReturnType<State['use']>,
    update: (value: StoreSetStateValue<ReturnType<State['use']>>) => void
  ) => React.ReactNode
}

/**
 * Renders the provided children function with the current value from the state.
 *
 * @template T The type of the state value.
 * @param props - The props object.
 * @param props.state - The ValueState whose value will be passed to children.
 * @param props.children - A render prop that receives the current value.
 * @returns The result of calling children with the current value.
 */
function Render<State extends ReadOnlyAtomLike<unknown>>({ state, children }: RenderProps<State>) {
  const value = state.use() as ReturnType<State['use']>
  return children(value)
}

/**
 * Renders the provided children function with the current value and an update function.
 *
 * The update function can set the value directly or with an updater function.
 *
 * @template T The type of the state value.
 * @template U The type allowed for updating the state (value or updater).
 * @param props - The props object.
 * @param props.state - The ValueState whose value will be passed to children.
 * @param props.children - A render prop that receives the current value and update function.
 * @returns The result of calling children with the current value and update function.
 */
function RenderWithUpdate<State extends AtomLike<unknown>>({
  state,
  children
}: RenderWithUpdateProps<State>) {
  type Value = ReturnType<State['use']>
  const value = state.use() as Value
  const update = useCallback(
    (value: StoreSetStateValue<Value>) => {
      if (typeof value !== 'function') {
        state.set(value as Parameters<State['set']>[0])
      } else {
        state.set((value as (prev: Value) => Value)(state.value as Value))
      }
    },
    [state]
  )
  return children(value, update)
}

/**
 * Conditionally renders the children function based on the result of the `on` predicate.
 *
 * @template T The type of the state value.
 * @param props - The props object.
 * @param props.state - The ValueState whose value will be used.
 * @param props.on - A predicate that receives the value and returns whether to show children.
 * @param props.children - A render prop that receives the current value for rendering if visible.
 * @returns The result of children if the predicate returns true, otherwise null.
 */
function Conditional<State extends ReadOnlyAtomLike<unknown>>({
  state,
  on,
  children
}: {
  state: State
  on: (value: ReturnType<State['use']>) => boolean
  children: (value: ReturnType<State['use']>) => React.ReactNode
}) {
  const value = state.use() as ReturnType<State['use']>
  const show = on(value) // on should not be expensive, memorizing just adds overhead
  if (!show) {
    return null
  }
  return children(value)
}
