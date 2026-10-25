import type { AvatarId, SkinId } from '../../../shared/contracts.ts'

const skins = [
  { id: 'CLASSIC', name: 'House deck', effect: 'Engraved gold', price: 0 },
  { id: 'AURORA', name: 'Aurora', effect: 'Liquid foil', price: 750 },
  {
    id: 'SUPERNOVA',
    name: 'Supernova',
    effect: 'Stellar fire',
    price: 1750
  },
  {
    id: 'PRISM',
    name: 'Prism',
    effect: 'Chromatic interference',
    price: 3500
  }
] satisfies { id: SkinId; name: string; effect: string; price: number }[]
const avatars = [
  { id: 'DEFAULT', name: 'Default Avatar', price: 0 },
  { id: 'BOXING_CAT', name: 'Boxing Cat', price: 0 },
  { id: 'PORTRAIT', name: '(look)', price: 500 },
  { id: 'GREEN_CHARACTER', name: 'mimimi', price: 5000 }
] satisfies { id: AvatarId; name: string; price: number }[]

/** Variants inherit this immutable catalog, never account ownership or wallets. */
export const classicCatalog = Object.freeze({
  skins: Object.freeze(skins.map((item) => Object.freeze(item))),
  avatars: Object.freeze(avatars.map((item) => Object.freeze(item)))
})
