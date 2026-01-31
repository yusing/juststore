import React, { useCallback, useEffect, useState } from 'react'
import { isEqual } from './impl'
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
      return states.map(state => state.value) as unknown as Readonly<T[keyof T][]>
    },
    use,
    useCompute<R>(fn: (value: readonly T[keyof T][]) => R) {
      const [value, setValue] = useState<R | undefined>(fn(this.value))

      const recompute = useCallback(() => {
        const newValue = fn(this.value)
        // skip update if the new value is the same as the previous value
        setValue(prev => (isEqual(prev, newValue) ? prev : newValue))
      }, [fn])

      useEffect(() => {
        const unsubscribeFns = states.map(state => state.subscribe(recompute))
        return () => {
          unsubscribeFns.forEach(unsubscribe => unsubscribe())
        }
      })

      return value
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
