import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { ZodError } from 'zod'
import { Identities, type Account } from './identity.ts'
import { Rooms } from './rooms.ts'
import { AppError } from './errors.ts'
import { socketMessage } from './validation.ts'
import { ROOM_POLL_MS } from './config.ts'

interface Peer {
  ws: WebSocket
  connectionId: string
  sessionId: string
  account: Account | null
  roomId: string | null
  chain: Promise<void>
  lastSent: string
  lastPong: number
  polling: boolean
  messages: number
  windowStarted: number
  pending: number
}

/** In-process sockets are only delivery handles; PostgreSQL owns rooms and presence. */
export class Realtime {
  private peers = new Set<Peer>()
  private poller: NodeJS.Timeout | undefined
  private heartbeats: NodeJS.Timeout | undefined
  private refreshing = new Map<string, Promise<void>>()
  private retiring = new Set<Promise<void>>()
  readonly sockets: WebSocketServer
  constructor(
    server: Server,
    private identities: Identities,
    private rooms: Rooms
  ) {
    this.sockets = new WebSocketServer({
      noServer: true,
      maxPayload: 256 * 1024,
    })
    server.on('upgrade', (request, socket, head) => {
      let allowed = true
      try {
        if (request.headers.origin) {
          const origin = new URL(request.headers.origin)
          allowed =
            origin.host === request.headers.host ||
            (!process.env.VERCEL &&
              ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
                request.socket.remoteAddress ?? ''
              ) &&
              ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
        }
      } catch {
        allowed = false
      }
      if (!allowed) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      this.sockets.handleUpgrade(request, socket, head, (ws) => this.attach(ws))
    })
  }
  private send(peer: Peer, type: string, payload: unknown) {
    if (peer.ws.readyState === WebSocket.OPEN) {
      if (peer.ws.bufferedAmount > 512 * 1024) {
        peer.ws.terminate()
        return
      }
      peer.ws.send(JSON.stringify({ type, payload }))
    }
  }
  private attach(ws: WebSocket) {
    const peer: Peer = {
      ws,
      connectionId: randomUUID(),
      sessionId: randomUUID(),
      account: null,
      roomId: null,
      chain: Promise.resolve(),
      lastSent: '',
      lastPong: Date.now(),
      polling: false,
      messages: 0,
      windowStarted: Date.now(),
      pending: 0,
    }
    this.peers.add(peer)
    this.startTimers()
    this.send(peer, 'AUTH_REQUIRED', {})
    const authenticationTimeout = setTimeout(() => {
      if (!peer.account) ws.close(1008, 'Authentication required')
    }, 12_000)
    const rotation = setTimeout(
      () => ws.close(1012, 'Reconnect to continue'),
      240_000
    )
    ws.on('pong', () => {
      peer.lastPong = Date.now()
    })
    ws.on('error', () => {})
    ws.on('message', (data) => {
      if (Date.now() - peer.windowStarted > 1000) {
        peer.windowStarted = Date.now()
        peer.messages = 0
      }
      if (++peer.messages > 50 || peer.pending >= 32) {
        ws.close(1008, 'Too many messages')
        return
      }
      peer.pending++
      peer.chain = peer.chain
        .then(async () => {
          if (ws.readyState !== WebSocket.OPEN) return
          let requestId: string | undefined
          try {
            const message = socketMessage.parse(JSON.parse(data.toString()))
            if (message.type === 'GAME_COMMAND') requestId = message.payload.requestId
            if (message.type === 'AUTH') {
              if (peer.account)
                throw new AppError(
                  409,
                  'This connection is already authenticated'
                )
              const account = await this.identities.authenticate(
                message.payload.deviceToken
              )
              const sessionId = message.payload.sessionId ?? peer.sessionId
              await this.rooms.authenticateSession(
                sessionId,
                peer.connectionId,
                account
              )
              peer.account = account
              peer.sessionId = sessionId
              clearTimeout(authenticationTimeout)
              this.send(peer, 'CONNECTED', { playerId: account.id })
              return
            }
            if (!peer.account)
              throw new AppError(401, 'Authenticate this device first')
            await this.rooms.heartbeat(peer.sessionId, peer.connectionId)
            if (message.type === 'SYNC_ROOM') {
              try {
                const previous = peer.roomId
                await this.rooms.enter(
                  peer.sessionId,
                  peer.connectionId,
                  message.payload.roomId,
                  peer.account
                )
                peer.roomId = message.payload.roomId
                peer.lastSent = ''
                if (previous && previous !== peer.roomId)
                  await this.refresh(previous)
                await this.refresh(peer.roomId)
              } catch (error) {
                this.send(peer, 'ROOM_REJECTED', {
                  roomId: message.payload.roomId,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Cannot enter this room',
                })
              }
            } else if (message.type === 'GAME_COMMAND') {
              if (peer.roomId !== message.payload.roomId)
                throw new AppError(403, 'Enter the room before playing')
              await this.rooms.command(peer.account, message.payload)
              if (message.payload.action === 'THROW') {
                // The purchase has committed. A failed broadcast must not make
                // the buyer mistake it for a failed purchase and pay again.
                await this.refresh(peer.roomId).catch(error => console.error('Throw broadcast failed', error))
                this.send(peer, 'THROW_CONFIRMED', { requestId })
              } else await this.refresh(peer.roomId)
            } else if (message.type === 'LEAVE_ROOM') {
              const previous = peer.roomId
              await this.rooms.leave(peer.sessionId, peer.connectionId)
              peer.roomId = null
              if (previous) await this.refresh(previous)
            }
          } catch (error) {
            this.send(peer, 'ERROR', {
              requestId,
              message:
                error instanceof ZodError
                  ? 'Invalid live message'
                  : error instanceof AppError
                    ? error.message
                    : 'The command could not be completed',
            })
            if (error instanceof AppError && error.status === 401)
              ws.close(1008, 'Identity or live session expired')
            else if (!(
              error instanceof AppError ||
              error instanceof ZodError ||
              error instanceof SyntaxError
            ))
              console.error('Live command failed', error)
          }
        })
        .catch((error) => console.error('Live connection failed', error))
        .finally(() => {
          peer.pending--
        })
    })
    ws.on('close', (code) => {
      clearTimeout(authenticationTimeout)
      clearTimeout(rotation)
      this.peers.delete(peer)
      if (!this.peers.size) {
        clearInterval(this.poller)
        clearInterval(this.heartbeats)
        this.poller = undefined
        this.heartbeats = undefined
      }
      // Rotation preserves the lease; deliberate close/quit retires it. A lost
      // network is considered offline only when its 45-second heartbeat expires.
      if (code === 1006 || code === 1012) return
      const retirement = peer.chain
        .then(async () => {
          if (peer.account) {
            await this.rooms.disconnect(peer.sessionId, peer.connectionId)
            if (peer.roomId) await this.refresh(peer.roomId)
          }
        })
        .catch((error) => console.error('Disconnect settlement failed', error))
        .finally(() => this.retiring.delete(retirement))
      this.retiring.add(retirement)
    })
  }
  private startTimers() {
    this.poller ??= setInterval(() => {
      for (const id of new Set(
        [...this.peers]
          .map((p) => p.roomId)
          .filter((id): id is string => Boolean(id))
      ))
        void this.refresh(id).catch((error) =>
          console.error('Room refresh failed', error)
        )
    }, ROOM_POLL_MS)
    this.heartbeats ??= setInterval(() => {
      for (const peer of this.peers) {
        if (Date.now() - peer.lastPong > 30_000) {
          peer.ws.terminate()
          continue
        }
        peer.ws.ping()
        if (!peer.account || peer.polling) continue
        peer.polling = true
        void this.rooms
          .heartbeat(peer.sessionId, peer.connectionId)
          .catch(() => peer.ws.close(1008, 'Live session expired'))
          .finally(() => {
            peer.polling = false
          })
      }
    }, 10_000)
  }
  async refresh(roomId: string): Promise<void> {
    const existing = this.refreshing.get(roomId)
    if (existing) return existing
    const job = (async () => {
      const peers = [...this.peers].filter(
        (peer) => peer.roomId === roomId && peer.account
      )
      if (!peers.length) return
      try {
        const room = await this.rooms.aggregate(roomId)
        for (const peer of peers)
          try {
            const view = this.rooms.project(room, peer.account!),
              serialized = JSON.stringify(view)
            if (serialized !== peer.lastSent) {
              this.send(peer, 'ROOM_STATE', view)
              peer.lastSent = serialized
            }
          } catch (error) {
            if (error instanceof AppError) {
              this.send(
                peer,
                error.status === 403 ? 'KICKED' : 'ROOM_REJECTED',
                { roomId, message: error.message }
              )
              peer.roomId = null
            } else throw error
          }
      } catch (error) {
        if (error instanceof AppError && error.status === 404) {
          for (const peer of peers) {
            this.send(peer, 'ROOM_DELETED', { roomId })
            peer.roomId = null
          }
        } else throw error
      }
    })().finally(() => this.refreshing.delete(roomId))
    this.refreshing.set(roomId, job)
    return job
  }
  async close() {
    const processing = [...this.peers].map((peer) => peer.chain)
    for (const peer of this.peers) peer.ws.close(1012, 'Server restarting')
    clearInterval(this.poller)
    clearInterval(this.heartbeats)
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()))
    await Promise.allSettled([
      ...processing,
      ...this.retiring,
      ...this.refreshing.values(),
    ])
  }
}
