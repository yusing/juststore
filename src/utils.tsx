import { Activity, useCallback } from 'react'
import type { Atom } from './atom'
import type { StoreSetStateValue, ValueState } from './types'

export { Render, RenderWithUpdate, Conditional, ConditionalRender }

type AtomLike<T> = Pick<Atom<T> | ValueState<T>, 'use' | 'set' | 'value'>
type ReadOnlyAtomLike<T> = Pick<Atom<T> | ValueState<T>, 'use' | 'useCompute' | 'value'>

type RenderProps<State extends ReadOnlyAtomLike<unknown>> = {
  state: State
  children: (value: State['value']) => React.ReactNode
}

type RenderWithUpdateProps<State extends AtomLike<unknown>> = {
  state: State
  children: (
    value: State['value'],
    update: (value: StoreSetStateValue<State['value']>) => void
  ) => React.ReactNode
}

type ConditionalProps<State extends ReadOnlyAtomLike<unknown>> = {
  state: State
  on: (value: State['value']) => boolean
  children: React.ReactNode
}

type ConditionalRenderProps<State extends ReadOnlyAtomLike<unknown>> = {
  state: State
  on: (value: State['value']) => boolean
  children: (value: State['value']) => React.ReactNode
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
  const value = state.use()
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
  type Value = State['value']
  const value = state.use()
  const update = useCallback(
    (value: StoreSetStateValue<Value>) => {
      if (typeof value !== 'function') {
        state.set(value)
      } else {
        state.set((value as (prev: Value) => Value)(state.value))
      }
    },
    [state]
  )
  return children(value, update)
}

/**
 * Conditionally shows or hides the children based on the result of the `on` predicate.
 *
 * It uses the Activity component to keep component states even when hidden.
 *
 * @template T The type of the state value.
 * @param props - The props object.
 * @param props.state - The ValueState whose value will be used.
 * @param props.on - A predicate that receives the value and returns whether to show children.
 * @param props.children - The component to render if the predicate returns true.
 * @returns The Activity component with the children.
 */
function Conditional<State extends ReadOnlyAtomLike<unknown>>({
  state,
  on,
  children
}: ConditionalProps<State>) {
  const show = state.useCompute(on)
  return <Activity mode={show ? 'visible' : 'hidden'}>{children}</Activity>
}

/**
 * Conditionally renders the children function based on the result of the `on` predicate.
 *
 * It returns null if the predicate returns false.
 *
 * @template T The type of the state value.
 * @param props - The props object.
 * @param props.state - The ValueState whose value will be used.
 * @param props.on - A predicate that receives the value and returns whether to show children.
 * @param props.children - The render function that receives the value.
 * @returns The result of children if the predicate returns true, otherwise null.
 */
function ConditionalRender<State extends ReadOnlyAtomLike<unknown>>({
  state,
  on,
  children
}: ConditionalRenderProps<State>) {
  const value = state.use()
  const show = on(value)
  if (!show) {
    return null
  }
  return children(value)
}
