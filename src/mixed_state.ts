import React from 'react'
import type { ReadOnlyState, ValueState } from './types'

export { createMixedState }

/**
 * Creates a mixed state that combines multiple states into a tuple.
 *
 * If one of the states is changed, the mixed state will be updated.
 *
 * @param states - Array of states to combine
 * @returns A new state that provides all values as a tuple
 *
 * @example
 * const mixedState = createMixedState(states.addLoading, states.copyLoading, state.agent)
 *
 * <mixedState.Render>
 *   {[addLoading, copyLoading, agent] => <SomeComponent />}
 * </mixedState.Render>
 */
function createMixedState<T extends readonly unknown[]>(
  ...states: { [K in keyof T]-?: ValueState<T[K]> }
): ReadOnlyState<T> {
  const use = () => states.map(state => state.use()) as unknown as Readonly<T>
  const mixedState = {
    get value() {
      return states.map(state => state.value) as unknown as Readonly<T>
    },
    use,
    useCompute<R>(fn: (value: unknown) => R) {
      return states.map(state => state.useCompute(value => fn(value)))
    },
    Render({ children }: { children: (value: Readonly<T>) => React.ReactNode }) {
      const value = use()
      return children(value)
    },
    Show({ children, on }: { children: React.ReactNode; on: (value: Readonly<T>) => boolean }) {
      const value = use()
      return on(value) ? children : null
    }
  } as const

  return mixedState as ReadOnlyState<T>
}
