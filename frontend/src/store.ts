import { create } from 'zustand'
import type { AvatarId, GameType, Player, RoomSummary, RoomView, SkinId, ThrowItemId } from './types'
import { applyRoomOperations, type RoomUpdate } from '../../shared/roomUpdates'

type GameAction = 'PLAY' | 'FOLD' | 'CHALLENGE' | 'SPELL_ANSWER' | 'SPELL_DRAFT'

interface Store {
  player: Player | null
  bootstrapping: boolean
  rooms: RoomSummary[]
  room: RoomView | null
  loading: boolean
  connected: boolean
  error: string | null
  socket: WebSocket | null
  debugMode: boolean
  switchIdentity: () => Promise<void>
  reconnect: () => void
  identify: (displayName: string) => Promise<void>
  renamePlayer: (displayName: string) => Promise<void>
  loadRooms: () => Promise<void>
  createRoom: (name: string, gameType?: GameType) => Promise<void>
  joinRoom: (roomId: string) => Promise<void>
  deleteRoom: (roomId: string) => Promise<void>
  kickPlayer: (roomId: string, playerId: string) => Promise<void>
  openRoom: (roomId: string) => Promise<void>
  leaveRoom: () => void
  startGame: (deckCount: number, cardsPerPlayer: number | null, randomDeckCount?: boolean) => Promise<void>
  changeAvatar: (avatarId: AvatarId, purchase?: boolean) => Promise<void>
  changeSkin: (skinId: SkinId, purchase: boolean) => Promise<void>
  stopGame: (gameId: string | null) => Promise<boolean>
  command: (action: GameAction, cardIds?: string[], declaredRank?: string, spellingId?: string, answer?: string) => void
  throwItem: (item: ThrowItemId, targetId: string) => boolean
  clearError: () => void
}

const PLAYER_KEY = 'bluff-table-player'
const DEVICE_TOKEN_KEY = 'bluff-table-device-token'
const DEBUG_KEY = 'bluff-table-debug-identity'
const saved = localStorage.getItem(PLAYER_KEY)
const rootPlayer = saved ? safePlayer(saved) : null
const rootToken = getOrCreateDeviceToken()
const debugIdentity = readDebugIdentity()
const initialPlayer = debugIdentity?.player ?? rootPlayer
let deviceToken = debugIdentity?.token ?? rootToken
let identityEpoch = 0
// Reuse only across reconnects in this page; identity switches receive a fresh lease.
let liveSessionId = crypto.randomUUID()
let navigation = 0
let reconnectTimer: number | undefined
let connectionTimer: number | undefined
let reconnectAttempts = 0
let draftTimer: number | undefined
type ThrowRequest = { playerId: string; payload: {
  roomId: string; gameId: string; requestId: string; action: 'THROW'; item: ThrowItemId; targetId: string
} }
type MoveRequest = { playerId: string; payload: { roomId: string; gameId?: string; requestId: string;
  action: GameAction; cardIds: string[]; declaredRank?: string; spellingId?: string; answer?: string } }
const pendingRequests = new Map<string, ThrowRequest | MoveRequest>()
let receiptSocket: WebSocket | null = null

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
        ...options?.headers,
      },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body?.message ?? `Server request failed (${response.status}). Please try again.`)
    }
    return response.status === 204 ? (undefined as T) : await response.json()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The server took too long to respond. Please try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function socketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

function isLoopbackBrowser() {
  return location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.hostname === '[::1]'
}

function identityEndpoint() {
  if (!isLoopbackBrowser()) return '/api/players'
  // Vite uses a separate backend; a built self-hosted app uses its own origin,
  // including custom PORT values. Never bake a localhost API URL into hosting.
  return import.meta.env.DEV
    ? `${import.meta.env.VITE_LOCAL_API_URL || 'http://127.0.0.1:8080'}/api/players`
    : '/api/players'
}

function restoreIdentity(displayName: string, legacyPlayerId?: string) {
  // Never submit a debug credential to the implicit-root registration endpoint.
  if (deviceToken !== rootToken) return api<Player>('/api/players/me')
  return api<Player>(identityEndpoint(), {
    method: 'POST',
    body: JSON.stringify({ legacyPlayerId, displayName, deviceToken }),
    headers: isLoopbackBrowser() ? { 'X-Bluff-Root-Claim': 'local-server-runner' } : undefined,
  })
}

export const useGameStore = create<Store>((set, get) => ({
  player: initialPlayer,
  bootstrapping: initialPlayer !== null,
  rooms: [],
  room: null,
  loading: false,
  connected: false,
  error: null,
  socket: null,
  debugMode: Boolean(debugIdentity),
  switchIdentity: async () => {
    if (get().room || get().loading || get().bootstrapping || (!get().debugMode && !get().player?.root)) return
    const requestEpoch = ++identityEpoch
    set({ loading: true, error: null })
    try {
      const returning = get().debugMode
      const targetToken = returning ? rootToken : undefined
      const result = returning
        ? { player: await api<Player>('/api/players/me', { headers: { Authorization: `Bearer ${rootToken}` } }), deviceToken: rootToken }
        : await api<{ player: Player; deviceToken: string }>('/api/players/me/debug-identity', { method: 'POST' })
      const targetRooms = await api<RoomSummary[]>('/api/rooms', {
        headers: { Authorization: `Bearer ${targetToken ?? result.deviceToken}` },
      })
      if (requestEpoch !== identityEpoch) return
      // Persist before retiring the current identity: a storage failure must
      // leave its credentials and socket intact, not half-switch the tab.
      if (returning) {
        localStorage.setItem(PLAYER_KEY, JSON.stringify(result.player))
        sessionStorage.removeItem(DEBUG_KEY)
      } else sessionStorage.setItem(DEBUG_KEY, JSON.stringify({ rootId: get().player!.id, token: result.deviceToken, player: result.player }))
      ++identityEpoch
      ++navigation
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(connectionTimer)
      if (get().socket) retireSocket(get().socket!)
      deviceToken = result.deviceToken
      pendingRequests.clear()
      liveSessionId = crypto.randomUUID()
      set({ player: result.player, debugMode: !returning, socket: null, connected: false, rooms: targetRooms, loading: false })
      connect(set, get)
    } catch (error) {
      if (requestEpoch === identityEpoch) set({ error: message(error), loading: false })
    }
  },
  reconnect: () => {
    const { player, bootstrapping, connected, socket } = get()
    if (player && !bootstrapping && !connected && (!socket || socket.readyState > WebSocket.OPEN)) connect(set, get)
  },

  identify: async (displayName) => {
    set({ loading: true, error: null })
    try {
      const player = await restoreIdentity(displayName, get().player?.id)
      savePlayer(player)
      set({ player, loading: false, bootstrapping: false })
      connect(set, get)
      await get().loadRooms()
    } catch (error) {
      // A cleared development database must not strand this tab on a stale bot credential.
      if (get().debugMode) { deviceToken = rootToken; sessionStorage.removeItem(DEBUG_KEY) }
      set({ player: null, debugMode: false, error: message(error), loading: false, bootstrapping: false })
    }
  },

  renamePlayer: async (displayName) => {
    if (!get().player) return
    const epoch = identityEpoch
    set({ loading: true, error: null })
    try {
      const player = await api<Player>('/api/players/me', {
        method: 'PATCH', body: JSON.stringify({ displayName }),
      })
      if (epoch !== identityEpoch) return
      savePlayer(player)
      set({ player, loading: false })
    } catch (error) { set({ error: message(error), loading: false }) }
  },

  loadRooms: async () => {
    const epoch = identityEpoch
    const player = get().player
    if (!player) return
    try {
      const rooms = await api<RoomSummary[]>('/api/rooms')
      if (epoch === identityEpoch) set({ rooms })
    } catch (error) { if (epoch === identityEpoch) set({ error: message(error) }) }
  },

  createRoom: async (name, gameType = 'LIARS_DECK') => {
    const player = get().player
    if (!player || get().loading) return
    const request = ++navigation
    set({ loading: true, error: null })
    try {
      const room = await api<RoomView>('/api/rooms', {
        method: 'POST', body: JSON.stringify({ name, gameType }),
      })
      if (request !== navigation) return
      set({ room, loading: false })
      if (get().connected) sendIfOpen(get().socket, { type: 'SYNC_ROOM', payload: { roomId: room.id } })
      await get().loadRooms()
    } catch (error) { if (request === navigation) set({ error: message(error), loading: false }) }
  },

  joinRoom: async (roomId) => {
    const player = get().player
    if (!player || get().loading) return
    const request = ++navigation
    set({ loading: true, error: null })
    try {
      const room = await api<RoomView>(`/api/rooms/${roomId}/join`, {
        method: 'POST',
      })
      if (request !== navigation) return
      set({ room, loading: false })
      if (get().connected) sendIfOpen(get().socket, { type: 'SYNC_ROOM', payload: { roomId } })
      await get().loadRooms()
    } catch (error) { if (request === navigation) set({ error: message(error), loading: false }) }
  },

  deleteRoom: async (roomId) => {
    const player = get().player
    if (!player) return
    try {
      await api<void>(`/api/rooms/${roomId}`, { method: 'DELETE' })
      if (get().room?.id === roomId) set({ room: null })
      await get().loadRooms()
    } catch (error) { set({ error: message(error) }) }
  },

  kickPlayer: async (roomId, playerId) => {
    try {
      await api<void>(`/api/rooms/${roomId}/players/${playerId}`, { method: 'DELETE' })
    } catch (error) { set({ error: message(error) }) }
  },

  openRoom: async (roomId) => {
    const player = get().player
    if (!player || get().loading) return
    const request = ++navigation
    set({ loading: true, error: null })
    try {
      const room = await api<RoomView>(`/api/rooms/${roomId}/snapshot`)
      if (request !== navigation) return
      set({ room, loading: false })
      if (get().connected) sendIfOpen(get().socket, { type: 'SYNC_ROOM', payload: { roomId } })
    } catch (error) { if (request === navigation) set({ error: message(error), loading: false }) }
  },

  leaveRoom: () => {
    ++navigation
    pendingRequests.clear()
    if (get().connected) sendIfOpen(get().socket, { type: 'LEAVE_ROOM', payload: {} })
    set({ room: null, loading: false })
    void get().loadRooms()
  },

  startGame: async (deckCount, cardsPerPlayer, randomDeckCount = false) => {
    const { player, room } = get()
    if (!player || !room) return
    set({ loading: true, error: null })
    try {
      await api<RoomView>(`/api/rooms/${room.id}/start`, {
        method: 'POST', body: JSON.stringify({ deckCount, cardsPerPlayer, randomDeckCount }),
      })
      set({ loading: false })
    } catch (error) { set({ error: message(error), loading: false }) }
  },

  stopGame: async (gameId) => {
    const room = get().room
    if (!room) return false
    set({ loading: true, error: null })
    try {
      await api<RoomView>(`/api/rooms/${room.id}/stop`, { method: 'POST', body: JSON.stringify({ gameId }) })
      set({ loading: false })
      return true
    } catch (error) { set({ loading: false, error: message(error) }); return false }
  },

  changeSkin: async (skinId, purchase) => {
    const room = get().room
    if (!room) return
    set({ loading: true, error: null })
    try {
      await api<RoomView>(`/api/rooms/${room.id}/skins/${purchase ? 'purchase' : 'equip'}`, {
        method: purchase ? 'POST' : 'PUT', body: JSON.stringify({ skinId }),
      })
      set({ loading: false })
    } catch (error) { set({ error: message(error), loading: false }) }
  },

  changeAvatar: async (avatarId, purchase = false) => {
    const room = get().room
    if (!room) return
    set({ loading: true, error: null })
    try {
      await api<RoomView>(`/api/rooms/${room.id}/avatars/${purchase ? 'purchase' : 'equip'}`, {
        method: purchase ? 'POST' : 'PUT', body: JSON.stringify({ avatarId }),
      })
      set({ loading: false })
    } catch (error) { set({ error: message(error), loading: false }) }
  },

  command: (action, cardIds = [], declaredRank, spellingId, answer) => {
    const { socket, room, connected } = get()
    if (!connected || !room || !socket || socket.readyState !== WebSocket.OPEN) {
      set({ error: 'Live connection is not ready yet' })
      return
    }
    const payload = { roomId: room.id, action, cardIds, declaredRank, spellingId, answer, requestId: crypto.randomUUID(), gameId: room.game?.gameId }
    if (action === 'SPELL_DRAFT' || action === 'SPELL_ANSWER') window.clearTimeout(draftTimer)
    const send = () => {
      if (get().socket !== socket || !get().connected || get().room?.id !== room.id || get().room?.game?.gameId !== payload.gameId) return
      if (action === 'SPELL_DRAFT' && (get().room?.game?.spelling?.id !== spellingId || get().room?.game?.spelling?.stage !== 'ACTIVE')) return
      if (action !== 'SPELL_DRAFT' && receiptSocket === socket && get().player) {
        pendingRequests.set(payload.requestId, { playerId: get().player!.id, payload: { ...payload, cardIds: [...cardIds] } })
      }
      try { socket.send(JSON.stringify({ type: 'GAME_COMMAND', payload })) }
      catch { set({ error: 'The connection closed before the move could be sent' }) }
    }
    // Send the last second's edits immediately so coalescing cannot postpone
    // the final draft past the server's auto-submit deadline.
    const spelling = room.game?.spelling
    if (action === 'SPELL_DRAFT' && (!spelling || spelling.deadline - spelling.serverNow > 1000 || !Number.isFinite(spelling.deadline))) draftTimer = window.setTimeout(send, 100)
    else send()
  },

  throwItem: (item, targetId) => {
    const { socket, room, connected, player } = get()
    if (!connected || !player || !room || room.game?.phase !== 'ACTIVE' || !socket || socket.readyState !== WebSocket.OPEN) {
      set({ error: 'Live connection is not ready yet' })
      return false
    }
    const request: ThrowRequest = { playerId: player.id, payload: { roomId: room.id, gameId: room.game.gameId,
      action: 'THROW', item, targetId, requestId: crypto.randomUUID() } }
    pendingRequests.set(request.payload.requestId, request)
    set({ error: null })
    try {
      socket.send(JSON.stringify({ type: 'GAME_COMMAND', payload: request.payload }))
      return true
    } catch {
      pendingRequests.delete(request.payload.requestId)
      set({ error: 'The connection closed before the throw could be sent' })
      return false
    }
  },

  clearError: () => set({ error: null }),
}))

function connect(set: (partial: Partial<Store>) => void, get: () => Store) {
  window.clearTimeout(reconnectTimer)
  window.clearTimeout(connectionTimer)
  const previous = get().socket
  if (previous) retireSocket(previous)
  set({ connected: false, socket: null })
  let socket: WebSocket
  try {
    socket = new WebSocket(socketUrl())
  } catch {
    scheduleReconnect(set, get, null)
    return
  }
  set({ socket })
  let retired = false
  let authenticated = false
  let authSent = false
  let roomRevision: number | null = null
  let revisionView: RoomView | null = null
  let resyncing = false
  const disconnect = (restoreDevice = false) => {
    if (retired || get().socket !== socket) return
    retired = true
    window.clearTimeout(connectionTimer)
    retireSocket(socket, true)
    set({ connected: false })
    // Function rotation is not a player quitting. Keep the table while its
    // database lease is alive; expired/departed players are rejected on resync.
    if (restoreDevice && get().player) {
      const profile = get().player!
      void restoreIdentity(profile.displayName, profile.id).then(player => {
        if (get().socket !== socket) return
        savePlayer(player)
        set({ player })
      }).catch(error => {
        if (get().socket === socket) set({ error: message(error) })
      }).finally(() => scheduleReconnect(set, get, socket))
    } else scheduleReconnect(set, get, socket)
  }
  const authenticate = () => {
    if (retired || get().socket !== socket || authSent) return
    try {
      socket.send(JSON.stringify({ type: 'AUTH', payload: { deviceToken, sessionId: liveSessionId, roomUpdates: 1 } }))
      authSent = true
      // Give authentication its own budget after the handshake. A slow cold
      // start must not consume almost all of the database authentication window.
      window.clearTimeout(connectionTimer)
      connectionTimer = window.setTimeout(() => disconnect(), 30_000)
    } catch { disconnect() }
  }
  // Covers stalled handshakes AND open sockets that never finish authentication.
  connectionTimer = window.setTimeout(() => disconnect(), 12000)
  socket.onopen = authenticate
  socket.onerror = () => disconnect()
  socket.onclose = event => disconnect(!authenticated && event?.code === 1008)
  socket.onmessage = (event) => {
    if (retired || get().socket !== socket) return
    let message
    try { message = JSON.parse(event.data) } catch { disconnect(); return }
    if (!message || typeof message !== 'object') { disconnect(); return }
    if (message.type === 'AUTH_REQUIRED' && !authenticated) authenticate()
    if (message.type === 'CONNECTED') {
      if (message.payload?.playerId !== get().player?.id) { disconnect(true); return }
      authenticated = true
      receiptSocket = message.payload?.commandReceipts === 1 ? socket : null
      reconnectAttempts = 0
      window.clearTimeout(connectionTimer)
      set({ connected: true })
      const room = get().room
      if (room) socket.send(JSON.stringify({ type: 'SYNC_ROOM', payload: { roomId: room.id } }))
      // Reuse receipts and original send order: recovery must never duplicate a
      // committed play or charge twice for a purchase whose reply was lost.
      for (const request of pendingRequests.values()) {
        if (request.playerId === get().player?.id && request.payload.roomId === room?.id
          && request.payload.gameId === room?.game?.gameId) {
          socket.send(JSON.stringify({ type: 'GAME_COMMAND', payload: request.payload }))
        }
      }
    }
    if (message.type === 'ROOM_STATE' && get().room?.id === message.payload.id) {
      roomRevision = Number.isSafeInteger(message.revision) ? message.revision : null
      resyncing = false
      setRoomIfChanged(set, get, message.payload)
      revisionView = get().room
    }
    if (message.type === 'ROOM_UPDATE') {
      const update = message.payload as RoomUpdate
      const current = get().room
      if (!current || current.id !== update.roomId || resyncing) return
      try {
        if (roomRevision === null || current !== revisionView || update.baseRevision !== roomRevision || update.revision !== roomRevision + 1) throw new Error('Room update out of sequence')
        const next = applyRoomOperations(current, update.operations)
        if (next.id !== current.id) throw new Error('Room changed during update')
        roomRevision = update.revision
        setRoomIfChanged(set, get, next)
        revisionView = get().room
      } catch {
        // A stale base is repaired on this connection, never by tearing down a
        // healthy socket. Old servers can still send ordinary ROOM_STATE frames.
        resyncing = true
        sendIfOpen(socket, { type: 'SYNC_ROOM', payload: { roomId: current.id } })
      }
    }
    if (['KICKED', 'ROOM_DELETED', 'ROOM_REJECTED'].includes(message.type) && get().room?.id === message.payload.roomId) {
      ++navigation
      pendingRequests.clear()
      set({ room: null, loading: false, error: message.type === 'ROOM_REJECTED' ? message.payload.message : message.type === 'KICKED' ? 'You were removed from the table' : 'This table was deleted' })
      void get().loadRooms()
    }
    if (message.type === 'ERROR') {
      pendingRequests.delete(message.payload.requestId)
      if (!authenticated) disconnect(true)
      else set({ error: message.payload.message })
    }
    if (message.type === 'THROW_CONFIRMED') pendingRequests.delete(message.payload.requestId)
    if (message.type === 'COMMAND_CONFIRMED') pendingRequests.delete(message.payload.requestId)
  }
}

function scheduleReconnect(set: (partial: Partial<Store>) => void, get: () => Store, socket: WebSocket | null) {
  if (!get().player || get().socket !== socket) return
  window.clearTimeout(reconnectTimer)
  const delay = Math.min(250 * 2 ** Math.min(reconnectAttempts++, 6), 10000)
  reconnectTimer = window.setTimeout(() => {
    if (get().player && get().socket === socket) connect(set, get)
  }, delay)
}

function retireSocket(socket: WebSocket, transient = false) {
  socket.onopen = null
  socket.onmessage = null
  socket.onerror = null
  socket.onclose = null
  // Recovery must not look like a deliberate quit: the server would retire the
  // player's room lease before the replacement connection can resume it.
  // Browser WebSocket.close accepts only 1000 or application codes 3000–4999.
  if (transient) socket.close(4000, 'Reconnecting')
  else socket.close()
}

function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong' }

function setRoomIfChanged(set: (partial: Partial<Store>) => void, get: () => Store, room: RoomView) {
  for (const [id, request] of pendingRequests) {
    if (request.payload.roomId === room.id
      && (room.game?.gameId !== request.payload.gameId || room.game?.phase !== 'ACTIVE')) pendingRequests.delete(id)
  }
  if (get().room?.id === room.id) {
    const shared = shareSnapshot(get().room, room)
    if (shared !== get().room) set({ room: shared })
  }
}

// Reuse unchanged card hands, avatars and action lists across authoritative
// snapshots so a wallet update does not repaint the entire table.
function shareSnapshot<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return next
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>
  const keys = Object.keys(after)
  let unchanged = keys.length === Object.keys(before).length
  for (const key of keys) {
    after[key] = shareSnapshot(before[key], after[key])
    if (!Object.hasOwn(before, key) || after[key] !== before[key]) unchanged = false
  }
  return unchanged ? previous : next
}

function sendIfOpen(socket: WebSocket | null, message: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function safePlayer(value: string): Player | null {
  try {
    const player = JSON.parse(value) as Player
    return player?.id && player?.displayName ? player : null
  } catch { return null }
}

function readDebugIdentity(): { rootId: string; token: string; player: Player } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(DEBUG_KEY) ?? 'null')
    return value?.rootId === rootPlayer?.id && rootPlayer?.root && typeof value.token === 'string'
      && value.token.length >= 32 && value.player?.id && !value.player.root ? value : null
  } catch { return null }
}

function savePlayer(player: Player) {
  if (deviceToken === rootToken) localStorage.setItem(PLAYER_KEY, JSON.stringify(player))
  else sessionStorage.setItem(DEBUG_KEY, JSON.stringify({ rootId: safePlayer(localStorage.getItem(PLAYER_KEY) ?? '')?.id, token: deviceToken, player }))
}

function getOrCreateDeviceToken() {
  const existing = localStorage.getItem(DEVICE_TOKEN_KEY)
  if (existing && existing.length >= 32) return existing
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  localStorage.setItem(DEVICE_TOKEN_KEY, token)
  return token
}

if (initialPlayer) queueMicrotask(() => {
  void useGameStore.getState().identify(initialPlayer.displayName)
})
