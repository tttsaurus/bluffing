import type { GameOutcome, GameView, PlayerRecord, RoomView, SkinId, TableAction } from './types'

export function recentActions(game: GameView): TableAction[] {
  // Older servers and saved deals may only have card-play history.
  if (game.actions?.length) return game.actions
  return (game.plays ?? []).map(play => ({ id: play.id, type: 'PLAY', playerId: play.playerId,
    playId: play.id, cardCount: play.cardCount, declaredRank: play.declaredRank }))
}

export const skinNames: Record<SkinId, string> = { CLASSIC: 'House deck', AURORA: 'Aurora', SUPERNOVA: 'Supernova', PRISM: 'Prism' }

export function rankRecords(records: PlayerRecord[], metric: 'wins' | 'bestStreak') {
  const sorted = records.filter(record => record[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || a.playerId.localeCompare(b.playerId))
  let rank = 0
  return sorted.map((record, index) => {
    if (index === 0 || record[metric] !== sorted[index - 1][metric]) rank = index + 1
    return { ...record, rank }
  })
}
export function tableSkins(room: RoomView) {
  const current = room.players.find(player => player.id === room.game?.currentPlayerId)
  const last = room.players.find(player => player.id === room.game?.lastClaim?.playerId)
  return { turn: current?.equippedSkin ?? 'CLASSIC', pool: last?.equippedSkin ?? current?.equippedSkin ?? 'CLASSIC' }
}

export function gameWallet(game: GameView, playerId: string) {
  return {
    earned: Math.max(0, (game.earnings?.find(entry => entry.playerId === playerId)?.amount ?? 0)
      - (game.throwSpending?.find(entry => entry.playerId === playerId)?.fromEarnings ?? 0)),
    pending: game.pendingClaim?.playerId === playerId ? game.pendingClaim.risk : 0,
  }
}

/** The server balance already contains confirmed earnings; split it only for display. */
export function walletBalances(game: GameView, playerId: string, balance: number) {
  const wallet = gameWallet(game, playerId)
  return { ...wallet, room: game.phase === 'ACTIVE' ? Math.max(0, balance - wallet.earned) : balance, available: balance }
}

export function turnOrder(game: GameView) {
  const current = game.hands.findIndex(hand => hand.playerId === game.currentPlayerId)
  if (current < 0) return []
  const seats = game.participants ?? game.hands.map(hand => hand.playerId)
  return game.hands.map((hand, index) => ({
    ...hand,
    ahead: (index - current + game.hands.length) % game.hands.length,
    seat: seats.indexOf(hand.playerId) + 1,
  }))
}

export function outcomeCopy(outcome: GameOutcome, viewerId: string, name: (id: string) => string) {
  const yours = outcome.playerId === viewerId
  const checking = outcome.challengerId === viewerId
  const defender = yours ? 'You' : name(outcome.playerId)
  const challenger = checking ? 'You' : outcome.challengerId ? name(outcome.challengerId) : ''
  switch (outcome.type) {
    case 'CHECK_SUCCEEDED': return { title: checking ? 'Truth Check won!' : yours ? 'Caught bluffing!' : 'Lie caught!',
      detail: `${defender} ${yours ? 'take' : 'takes'} the ${outcome.poolSize}-card pool.`, tone: yours ? 'loss' : 'win', mark: checking ? '✓' : '!' }
    case 'CHECK_FAILED': return { title: checking ? 'Truth Check lost!' : yours ? 'Truth defended!' : 'It was the truth!',
      detail: `${challenger} ${checking ? 'take' : 'takes'} the ${outcome.poolSize}-card pool.`, tone: checking ? 'loss' : 'win', mark: checking ? '×' : '✓' }
    case 'PLAY_PASSED': return { title: yours ? 'Your play passed!' : `${defender}'s play passed!`,
      detail: 'Played over. No longer challengeable.', tone: 'safe', mark: '✓' }
    case 'POOL_PASSED': return { title: yours ? 'Your play passed!' : 'The pool passed!',
      detail: 'Everyone folded. Pool cleared, reward secured.', tone: 'safe', mark: '✓' }
    case 'GAME_WON': return { title: yours ? 'You won the deal!' : `${defender} won the deal!`,
      detail: 'Final play accepted. Winner bonus secured.', tone: 'win', mark: '♛' }
    case 'PLAY_VOIDED': return { title: yours ? 'Pending play cancelled' : 'Pool discarded',
      detail: 'A player left. No pending reward paid.', tone: 'void', mark: '—' }
  }
}

// Sequence IDs survive repeated room snapshots; repeated text must not replay receipts.
export function freshOutcomes(outcomes: GameOutcome[], lastId: number) {
  return outcomes.filter(outcome => outcome.id > lastId).sort((a, b) => a.id - b.id)
}

export function shouldNotifyOutcome(outcome: GameOutcome, viewerId: string) {
  if (outcome.type === 'CHECK_SUCCEEDED' || outcome.type === 'CHECK_FAILED') {
    return outcome.playerId === viewerId || outcome.challengerId === viewerId
  }
  return outcome.playerId === viewerId || outcome.rewardPlayerId === viewerId
}
