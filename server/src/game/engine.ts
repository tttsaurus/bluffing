import type { GameType } from '../../../shared/contracts.ts'
import { invariant } from '../errors.ts'
import { LiarsDeckEngine } from './classic.ts'
import { LiarsDeckPlusEngine } from './plus.ts'
import { LiarsDeck4FunEngine } from './four-fun.ts'

export { LiarsDeckEngine, LiarsDeckPlusEngine, LiarsDeck4FunEngine }

/** Separate, stateless engines; shared behaviour is inherited from classic. */
const engines: ReadonlyMap<GameType, LiarsDeckEngine> = new Map<GameType, LiarsDeckEngine>([
  ['LIARS_DECK', new LiarsDeckEngine()],
  ['LIARS_DECK_PLUS', new LiarsDeckPlusEngine()],
  ['LIARS_DECK_4_FUN', new LiarsDeck4FunEngine()]
])
for (const rules of engines.values()) Object.freeze(rules)
export function engine(type: GameType): LiarsDeckEngine {
  const found = engines.get(type)
  invariant(found, 'Unknown room type', 400)
  return found
}
