import type { ThrowItemId } from './contracts.ts'

export const throwItems: Readonly<Record<ThrowItemId, { name: string; price: number; mark: string }>> = Object.freeze({
  TOMATO: Object.freeze({ name: 'Tomato', price: 100, mark: '🍅' }),
  AIRPLANE: Object.freeze({ name: 'Airplane', price: 500, mark: '✈' }),
  COFFEE: Object.freeze({ name: 'Coffee', price: 300, mark: '☕' }),
})
