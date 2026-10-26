import { describe, expect, it } from 'vitest'
import { freshOutcomes, gameWallet, walletBalances, outcomeCopy, rankRecords, shouldNotifyOutcome, tableSkins, turnOrder } from '../src/presentation'
import { game, other, outcome, room, self } from './fixtures'
import type { GameOutcome } from '../src/types'

describe('wallet isolation and receipts', () => {
  it.each([200, 50, 0])('one tomato lowers the total exactly 100 with %s earned coins', earned => {
    const view = game({ earnings: [{ playerId: self.id, amount: earned }],
      pendingClaim: { playerId: self.id, cardCount: 20, generation: 5, risk: 5000 } })
    const before = walletBalances(view, self.id, 500 + earned)
    const fromEarnings = Math.min(100, earned)
    const after = walletBalances({ ...view, throwSpending: [{ playerId: self.id, amount: 100, fromEarnings }] }, self.id, 400 + earned)
    expect(before).toEqual({ earned, pending: 5000, room: 500, available: 500 + earned })
    expect(before.available - after.available).toBe(100)
    expect(after.room + after.earned).toBe(after.available)
    expect(after.earned).toBe(earned - fromEarnings)
  })
  it('separates confirmed earnings from an unresolved claim and other wallets', () => {
    const view = game({ earnings: [{ playerId: self.id, amount: 60 }, { playerId: other.id, amount: 900 }],
      pendingClaim: { playerId: self.id, cardCount: 2, generation: 3, risk: 60 } })
    expect(gameWallet(view, self.id)).toEqual({ earned: 60, pending: 60 })
    expect(gameWallet(view, other.id)).toEqual({ earned: 900, pending: 0 })
    expect(gameWallet(view, 'spectator')).toEqual({ earned: 0, pending: 0 })
  })

  it('sorts new receipts without changing or replaying the original list', () => {
    const receipts = [outcome({ id: 3 }), outcome({ id: 1 }), outcome({ id: 2 })]
    expect(freshOutcomes(receipts, 1).map(receipt => receipt.id)).toEqual([2, 3])
    expect(receipts.map(receipt => receipt.id)).toEqual([3, 1, 2])
    expect(freshOutcomes(receipts, 3)).toEqual([])
  })

  it.each(['PLAY_PASSED', 'POOL_PASSED', 'GAME_WON', 'PLAY_VOIDED'] as const)('does not notify spectators about %s', type => {
    expect(shouldNotifyOutcome(outcome({ type }), self.id)).toBe(true)
    expect(shouldNotifyOutcome(outcome({ type }), other.id)).toBe(false)
  })

  it.each(['CHECK_SUCCEEDED', 'CHECK_FAILED'] as const)('only notifies the participants of %s', type => {
    const receipt = outcome({ type, challengerId: other.id })
    expect(shouldNotifyOutcome(receipt, self.id)).toBe(true)
    expect(shouldNotifyOutcome(receipt, other.id)).toBe(true)
    expect(shouldNotifyOutcome(receipt, 'spectator')).toBe(false)
  })

  it.each<GameOutcome['type']>(['PLAY_PASSED', 'POOL_PASSED', 'GAME_WON', 'PLAY_VOIDED', 'CHECK_SUCCEEDED', 'CHECK_FAILED'])(
    'provides readable %s feedback for defender, challenger and spectator', type => {
      for (const viewer of [self.id, other.id, 'spectator']) {
        const copy = outcomeCopy(outcome({ type, challengerId: other.id }), viewer, id => `Player ${id}`)
        expect(copy.title.length).toBeGreaterThan(3)
        expect(copy.detail).not.toContain('undefined')
        expect(copy.mark).toBeTruthy()
      }
    })
})

describe('fixed seats, rankings and skins', () => {
  it('wraps the active indicator while keeping surviving original seat numbers', () => {
    const view = game({ currentPlayerId: other.id, participants: [self.id, 'departed', other.id] })
    expect(turnOrder(view).map(hand => [hand.playerId, hand.seat, hand.ahead])).toEqual([
      [self.id, 1, 1], [other.id, 3, 0],
    ])
    expect(turnOrder({ ...view, currentPlayerId: self.id }).map(hand => hand.playerId)).toEqual([self.id, other.id])
    expect(turnOrder({ ...view, currentPlayerId: null })).toEqual([])
  })

  it('uses classic skins when a viewer or last claimant is absent', () => {
    expect(tableSkins(room({ players: [] }))).toEqual({ turn: 'CLASSIC', pool: 'CLASSIC' })
    const view = room()
    view.players[0].equippedSkin = 'PRISM'
    expect(tableSkins(view)).toEqual({ turn: 'PRISM', pool: 'PRISM' })
  })

  it('orders tied records deterministically without mutating input', () => {
    const records = ['z', 'a', 'b'].map(playerId => ({ playerId, displayName: 'Same name', identityTag: playerId,
      wins: playerId === 'b' ? 0 : 2, currentStreak: 0, bestStreak: 1 }))
    expect(rankRecords(records, 'wins').map(record => [record.playerId, record.rank])).toEqual([['a', 1], ['z', 1]])
    expect(records.map(record => record.playerId)).toEqual(['z', 'a', 'b'])
    expect(rankRecords([], 'bestStreak')).toEqual([])
  })
})
