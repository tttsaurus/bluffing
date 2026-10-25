import { useId, useState } from 'react'
import { PlayerAvatar } from './PlayerAvatar'
import { CardBack } from './CardBack'
import { useGameStore } from './store'
import type { Avatar, Skin } from './types'
import { Modal } from './Modal'

export function DeckShop() {
  const { room, player, changeSkin, changeAvatar, loading, connected } = useGameStore()
  const [confirm, setConfirm] = useState<Skin | null>(null)
  const [confirmAvatar, setConfirmAvatar] = useState<Avatar | null>(null)
  const [category, setCategory] = useState<'decks' | 'avatars'>('decks')
  const titleId = useId()
  if (!room || !player) return null
  const member = room.players.find(p => p.id === player.id)
  const balance = member?.balance ?? 0
  const purchasesLocked = room.status === 'IN_GAME'
  return <section className="deck-shop" aria-labelledby={titleId}>
    <div className="shop-heading"><h2 id={titleId}>Own the <em>spotlight.</em></h2>
      <div className="shop-wallet"><span>YOUR ROOM COINS</span><strong>◆ {balance.toLocaleString()}</strong></div></div>
    <div className="shop-categories" role="group" aria-label="Shop category">
      <button aria-pressed={category === 'decks'} onClick={() => setCategory('decks')}>Decks</button>
      <button aria-pressed={category === 'avatars'} onClick={() => setCategory('avatars')}>Avatars</button>
    </div>
    {category === 'avatars' ? <div className="skin-grid avatar-grid">{(room.avatars ?? [{ id: 'DEFAULT', name: 'Default Avatar', price: 0, owned: true }, { id: 'BOXING_CAT', name: 'Boxing Cat', price: 0, owned: true }] as Avatar[]).map(avatar => {
      const equipped = (member?.equippedAvatar ?? 'DEFAULT') === avatar.id
      const affordable = balance >= avatar.price
      return <article className={`skin-item ${equipped ? 'equipped' : ''}`} key={avatar.id}>
        <div className="avatar-shop-stage"><div className="avatar-shop-preview"><PlayerAvatar avatar={avatar.id} /></div></div>
        <div className="skin-details"><span className="skin-effect">{avatar.price === 0 ? 'FREE · 0 COINS' : `◆ ${avatar.price.toLocaleString()} COINS`}</span><h3>{avatar.name}</h3>
          <button disabled={equipped || loading || !connected || !member || (!avatar.owned && (purchasesLocked || !affordable))}
            onClick={() => avatar.owned ? void changeAvatar(avatar.id) : setConfirmAvatar(avatar)}>
            {equipped ? '✓ Equipped' : avatar.owned ? avatar.price === 0 ? 'Equip for free' : 'Equip avatar' : `Unlock · ◆ ${avatar.price.toLocaleString()}`}
          </button>
          {!avatar.owned && purchasesLocked && <span className="skin-shortfall">Unlock between deals</span>}
          {!avatar.owned && !purchasesLocked && !affordable && <span className="skin-shortfall">◆ {(avatar.price - balance).toLocaleString()} to go</span>}
        </div>
      </article>
    })}</div> : <div className="skin-grid">{(room.skins ?? []).map(skin => {
      const equipped = skin.id === member?.equippedSkin
      const affordable = balance >= skin.price
      return <article className={`skin-item ${equipped ? 'equipped' : ''}`} key={skin.id}>
        <div className="skin-stage"><span className="edition-label">{skin.id === 'CLASSIC' ? 'ORIGINAL' : 'SPECIAL EDITION'}</span><CardBack skin={skin.id} /></div>
        <div className="skin-details"><span className="skin-effect">{skin.effect}</span><h3>{skin.name}</h3>
          <button disabled={equipped || loading || !connected || !member || (!skin.owned && (purchasesLocked || !affordable))}
            onClick={() => skin.owned ? void changeSkin(skin.id, false) : setConfirm(skin)}>
            {equipped ? '✓ Equipped' : skin.owned ? 'Equip deck' : `Unlock · ◆ ${skin.price}`}
          </button>
          {!skin.owned && purchasesLocked && <span className="skin-shortfall">Unlock between deals</span>}
          {!skin.owned && !purchasesLocked && !affordable && <span className="skin-shortfall">◆ {skin.price - balance} to go</span>}
        </div>
      </article>
    })}</div>}
    {confirmAvatar && <Modal label={`Unlock ${confirmAvatar.name}`} onClose={() => setConfirmAvatar(null)}><div className="purchase-confirm">
      <div><strong>Unlock your {confirmAvatar.name} avatar in this room?</strong><span>◆ {confirmAvatar.price.toLocaleString()} from your balance · ◆ {(balance - confirmAvatar.price).toLocaleString()} remaining</span></div>
      <button className="text-button" onClick={() => setConfirmAvatar(null)}>Cancel</button>
      <button className="primary compact" disabled={loading || balance < confirmAvatar.price || !connected || purchasesLocked} onClick={() => { void changeAvatar(confirmAvatar.id, true); setConfirmAvatar(null) }}>Buy &amp; equip</button>
    </div></Modal>}
    {confirm && <Modal label={`Unlock ${confirm.name}`} onClose={() => setConfirm(null)}><div className="purchase-confirm">
      <div><strong>Unlock your {confirm.name} deck in this room?</strong><span>◆ {confirm.price} from your balance · ◆ {balance - confirm.price} remaining</span></div>
      <button className="text-button" onClick={() => setConfirm(null)}>Cancel</button>
      <button className="primary compact" disabled={loading || balance < confirm.price || !connected} onClick={() => { void changeSkin(confirm.id, true); setConfirm(null) }}>Buy & equip</button>
    </div></Modal>}
  </section>
}
