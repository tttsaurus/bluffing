import { z } from 'zod'

export const uuid = z.uuid()
export const gameType = z.enum([
  'LIARS_DECK',
  'LIARS_DECK_PLUS',
  'LIARS_DECK_4_FUN',
  'LIARS_DECK_4FUN_PLUS',
])
export const identify = z.object({
  displayName: z.string().trim().min(1).max(24),
  deviceToken: z.string().min(32).max(200),
  legacyPlayerId: uuid.nullish(),
})
export const rename = identify.pick({ displayName: true })
export const createRoom = z.object({
  name: z.string().max(40).optional(),
  gameType,
})
export const startGame = z.object({
  deckCount: z.number().int().min(1).max(8),
  cardsPerPlayer: z.number().int().min(1).max(432).nullable().default(null),
  randomDeckCount: z.boolean().default(false),
})
export const stopGame = z.object({ gameId: uuid.nullable() })
export const command = z.object({
  roomId: uuid,
  action: z.enum(['PLAY', 'FOLD', 'CHALLENGE', 'SPELL_ANSWER', 'SPELL_DRAFT', 'THROW']),
  item: z.enum(['TOMATO', 'AIRPLANE', 'COFFEE']).optional(),
  targetId: uuid.optional(),
  cardIds: z.array(uuid).default([]),
  declaredRank: z.string().max(5).optional(),
  spellingId: uuid.optional(),
  answer: z.string().max(64).optional(),
  requestId: uuid.optional(),
  gameId: uuid.optional(),
}).superRefine((value, context) => {
  if (value.action !== 'THROW') return
  for (const key of ['item', 'targetId', 'gameId', 'requestId'] as const) {
    if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: 'Required for a throw' })
  }
})
export const socketMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('AUTH'),
    payload: z.object({
      deviceToken: z.string().min(32).max(200),
      sessionId: uuid.optional(),
    }),
  }),
  z.object({
    type: z.literal('SYNC_ROOM'),
    payload: z.object({ roomId: uuid }),
  }),
  z.object({ type: z.literal('GAME_COMMAND'), payload: command }),
  z.object({ type: z.literal('LEAVE_ROOM'), payload: z.object({}) }),
])
