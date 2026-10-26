import { throwItems } from '../../../shared/throwables.ts'
import { invariant } from '../errors.ts'
import type { GameCommand, GameState } from './state.ts'

export function confirmedEarnings(state: GameState, playerId: string): number {
  return Math.max(0, (state.earnings[playerId] ?? 0) - (state.throwSpending?.[playerId]?.fromEarnings ?? 0))
}

/** Net wallet movements, including purchases funded by pre-deal room coins. */
export function gameCashflow(state: GameState): Record<string, number> {
  return Object.fromEntries(state.participants.map(id => [id,
    (state.earnings[id] ?? 0) - (state.throwSpending?.[id]?.amount ?? 0),
  ]))
}

export function purchaseThrow(state: GameState, playerId: string, command: GameCommand, walletBalance: number) {
  invariant(state.phase === 'ACTIVE', 'Throwing items are only available during a deal')
  invariant(state.order.includes(playerId), 'Only players in this deal can throw items')
  invariant(command.targetId && command.targetId !== playerId && state.order.includes(command.targetId), 'Choose another player in this deal')
  invariant(command.item && Object.hasOwn(throwItems, command.item), 'Unknown throwing item', 400)
  const item = throwItems[command.item]
  // Room balances already include confirmed game payouts. Never add earnings to
  // this balance again, and never include an unverified pending claim.
  invariant(Number.isSafeInteger(walletBalance) && walletBalance >= item.price, 'Not enough coins for this throw')
  const previous = state.throwSpending?.[playerId] ?? { amount: 0, fromEarnings: 0 }
  const confirmed = confirmedEarnings(state, playerId)
  const fromEarnings = Math.min(confirmed, item.price)
  state.throwSpending ??= {}
  state.throwSpending[playerId] = { amount: previous.amount + item.price, fromEarnings: previous.fromEarnings + fromEarnings }
  const throws = state.throws ??= []
  throws.push({ id: (throws.at(-1)?.id ?? 0) + 1, playerId, targetId: command.targetId,
    item: command.item, cost: item.price, fromEarnings, fromWallet: item.price - fromEarnings })
  if (throws.length > 24) throws.shift()
}
