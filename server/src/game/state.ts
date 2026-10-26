import type {
  Card,
  Claim,
  GameOutcome,
  GameType,
  GameView,
  ThrowItemId,
} from '../../../shared/contracts.ts'

export const RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const
export interface InternalClaim extends Claim {
  cards: Card[]
}
export interface Word {
  id: string
  text: string
  alternatives: string[]
}
export interface SpellingRound {
  id: string
  defender: string
  penalty: number
  deadline: number
  stage: 'ACTIVE' | 'COMPLETE' | 'CANCELLED'
  questions: Record<string, Word>
  answers: Record<string, string>
  drafts: Record<string, string>
  results: NonNullable<GameView['spelling']>['results']
}
/** JSON-serializable, server-only state. Never send this object to a client. */
export interface GameState {
  schemaVersion: 1
  gameId: string
  roomId: string
  type: GameType
  phase: 'ACTIVE' | 'FINISHED'
  deckCount: number
  cardsPerPlayer: number
  order: string[]
  participants: string[]
  hands: Record<string, Card[]>
  pool: Card[]
  reserve: Card[]
  usedWords: string[]
  claims: InternalClaim[]
  pendingClaim: InternalClaim | null
  currentIndex: number
  initializerIndex: number
  consecutiveFolds: number
  targetRank: string | null
  earnings: Record<string, number>
  throwSpending?: Record<string, { amount: number; fromEarnings: number }>
  throws?: GameView['throws']
  outcomes: GameOutcome[]
  plays: NonNullable<GameView['plays']>
  actions?: GameView['actions']
  events: string[]
  winnerId: string | null
  lastNonFoldedPlayerId: string | null
  spelling: SpellingRound | null
  playSequence: number
  outcomeSequence: number
}
export interface StartSettings {
  deckCount: number
  cardsPerPlayer: number | null
  randomDeckCount?: boolean
}
export interface GameCommand {
  roomId: string
  action: 'PLAY' | 'FOLD' | 'CHALLENGE' | 'SPELL_ANSWER' | 'SPELL_DRAFT' | 'THROW'
  item?: ThrowItemId
  targetId?: string
  cardIds?: string[]
  declaredRank?: string
  spellingId?: string
  answer?: string
  requestId?: string
  gameId?: string
}
