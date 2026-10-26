export type GameType = 'LIARS_DECK' | 'LIARS_DECK_PLUS' | 'LIARS_DECK_4_FUN' | 'LIARS_DECK_4FUN_PLUS'
export type RoomStatus = 'LOBBY' | 'IN_GAME'
export type Suit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'JOKER'

export interface Player {
  id: string
  displayName: string
  identityTag: string
  root: boolean
}
export interface Card {
  id: string
  rank: string
  suit: Suit
}
export type AvatarId = 'DEFAULT' | 'BOXING_CAT' | 'PORTRAIT' | 'GREEN_CHARACTER'

export interface Member {
  id: string
  displayName: string
  identityTag: string
  seatIndex: number
  /** Total spendable coins, including unspent confirmed game earnings. */
  balance: number
  host: boolean
  presence: 'ACTIVE' | 'AWAY' | 'OFFLINE'
  equippedAvatar?: AvatarId
  equippedSkin: SkinId
}
export interface Claim {
  playerId: string
  cardCount: number
  generation: number
  risk: number
}
export interface GameOutcome {
  id: number
  type:
    | 'PLAY_PASSED'
    | 'POOL_PASSED'
    | 'CHECK_SUCCEEDED'
    | 'CHECK_FAILED'
    | 'GAME_WON'
    | 'PLAY_VOIDED'
  playerId: string
  challengerId: string | null
  rewardPlayerId: string | null
  amount: number
  poolSize: number
  declaredRank: string | null
  revealedCards: Card[]
}
export interface SpellingView {
  id: string
  stage: 'ACTIVE' | 'COMPLETE' | 'CANCELLED'
  serverNow: number
  deadline: number
  penalty: number
  audioUrl: string | null
  submitted: boolean
  submittedCount: number
  playerCount: number
  results: {
    playerId: string
    word: string
    answer: string
    correct: boolean
    drawn: number
  }[]
}
export interface GameView {
  throws?: ThrowEvent[]
  throwSpending?: { playerId: string; amount: number; fromEarnings: number }[]
  /** Ordered public actions. Card faces stay in the viewer-filtered plays list. */
  actions?: TableAction[]
  spelling?: SpellingView | null
  lastNonFoldedPlayerId?: string | null
  gameId: string
  phase: 'ACTIVE' | 'FINISHED'
  deckCount: number
  cardsPerPlayer: number
  currentPlayerId: string | null
  initializerId: string | null
  targetRank: string | null
  poolSize: number
  generation: number
  consecutiveFolds: number
  lastClaim: Claim | null
  hand: Card[]
  hands: { playerId: string; cardCount: number }[]
  events: string[]
  winnerId: string | null
  participants: string[]
  pendingClaim: Claim | null
  earnings: { playerId: string; amount: number }[]
  plays?: {
    id: number
    playerId: string
    declaredRank: string
    cardCount: number
    status: 'PENDING' | 'PASSED' | 'TRUTH' | 'LIE' | 'VOIDED'
    challengerId?: string | null
    revealedCards: Card[]
  }[]
  outcomes: GameOutcome[]
}
export type ThrowItemId = 'TOMATO' | 'AIRPLANE' | 'COFFEE'
export interface ThrowEvent {
  id: number
  playerId: string
  targetId: string
  item: ThrowItemId
  cost: number
  fromEarnings: number
  fromWallet: number
}
export interface TableAction {
  id: number
  type: 'PLAY' | 'FOLD' | 'CHALLENGE'
  playerId: string
  playId?: number
  cardCount: number
  declaredRank: string | null
}
export interface RoomSummary {
  id: string
  name: string
  gameType: GameType
  status: RoomStatus
  hostId: string
  playerCount: number
  maxPlayers: number
  activePlayerCount: number
  createdAt: string
  joined: boolean
}
export interface Avatar {
  id: AvatarId
  name: string
  price: number
  owned: boolean
}
export interface RoomView {
  avatars?: Avatar[]
  id: string
  name: string
  gameType: GameType
  status: RoomStatus
  hostId: string
  players: Member[]
  game: GameView | null
  skins: Skin[]
  records: PlayerRecord[]
  notice: string | null
}
export interface PlayerRecord {
  playerId: string
  displayName: string
  identityTag: string
  wins: number
  currentStreak: number
  bestStreak: number
}
export type SkinId = 'CLASSIC' | 'AURORA' | 'SUPERNOVA' | 'PRISM'
export interface Skin {
  id: SkinId
  name: string
  effect: string
  price: number
  owned: boolean
}
