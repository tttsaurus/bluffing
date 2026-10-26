import { memo } from 'react'
import type { AvatarId } from './types'

export const PlayerAvatar = memo(function PlayerAvatar({ avatar }: { avatar?: AvatarId }) {
  const images = {
    BOXING_CAT: { src: '/avatars/boxing-cat.png', alt: 'Boxing cat' },
    PORTRAIT: { src: '/avatars/portrait.png', alt: '(look)' },
    GREEN_CHARACTER: { src: '/avatars/green-character.gif', alt: 'mimimi' },
  }
  const image = avatar && avatar !== 'DEFAULT' ? images[avatar] : undefined
  return image
    ? <img className="player-avatar-image" src={image.src} alt={image.alt} />
    : <svg className="player-avatar-default" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="25" r="11" fill="currentColor" /><path d="M12 58c0-14 8-21 20-21s20 7 20 21" fill="currentColor" /><path d="m25 10 7-5 7 5-7 5z" fill="currentColor" opacity=".5" /></svg>
})
