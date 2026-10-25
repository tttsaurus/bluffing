import { randomInt, randomUUID } from 'node:crypto'
import type pg from 'pg'
import type {
  AvatarId,
  GameType,
  RoomSummary,
  RoomView,
  SkinId,
} from '../../shared/contracts.ts'
import { transaction, type DbClient } from './db.ts'
import { engine } from './game/engine.ts'
import type { GameCommand, GameState, StartSettings } from './game/state.ts'
import { AppError, invariant } from './errors.ts'
import type { Account } from './identity.ts'
import { PRESENCE_TTL_MS } from './config.ts'

interface Membership {
  id: string
  room_id: string
  player_id: string
  display_name: string
  seat_index: number
  active: boolean
  balance: number
  game_start_balance: number | null
  equipped_skin: SkinId
  equipped_avatar: AvatarId
  wins: number
  current_streak: number
  best_streak: number
  owned_skins: string[]
  owned_avatars: string[]
}
export interface Aggregate {
  id: string
  name: string
  game_type: GameType
  host_id: string
  status: 'LOBBY' | 'IN_GAME'
  created_at: Date
  version: string
  game_state: GameState | null
  last_notice: string | null
  last_recorded_game_id: string | null
  members: Membership[]
  presence: { player_id: string; room_id: string | null }[]
  deleted?: boolean
}
function tag(id: string) {
  return id.replaceAll('-', '').slice(0, 5)
}
function present(room: Aggregate, id: string) {
  return room.presence.some(
    (item) => item.player_id === id && item.room_id === room.id
  )
}
function member(room: Aggregate, id: string) {
  const found = room.members.find(
    (item) => item.player_id === id && item.active
  )
  invariant(found, 'Join this room first', 403)
  return found
}
function requireAccess(room: Aggregate, actor: Account) {
  if (actor.root_account || room.host_id === actor.id) return
  member(room, actor.id)
  invariant(
    room.game_state?.phase !== 'ACTIVE' ||
      room.game_state.order.includes(actor.id),
    'You are not in this deal. Wait for the next game to enter'
  )
}
function requireModerator(room: Aggregate, actor: Account) {
  invariant(
    room.host_id === actor.id || actor.root_account,
    'Only the host or root can do that',
    403
  )
}
function balanceRestore(room: Aggregate) {
  for (const item of room.members) {
    if (item.game_start_balance != null) item.balance = item.game_start_balance
    item.game_start_balance = null
  }
}
function settle(room: Aggregate, beforeEarnings: Record<string, number>) {
  const state = room.game_state
  if (!state) return
  for (const item of room.members) {
    const delta =
      (state.earnings[item.player_id] ?? 0) -
      (beforeEarnings[item.player_id] ?? 0)
    invariant(
      delta >= 0 && Number.isSafeInteger(item.balance + delta),
      'Invalid wallet settlement',
      500
    )
    item.balance += delta
  }
  if (state.phase !== 'FINISHED') return
  room.status = 'LOBBY'
  if (!state.winnerId) {
    balanceRestore(room)
    room.last_notice =
      'Deal ended with one or fewer players. Every room wallet was restored to its pre-deal balance.'
  } else {
    if (room.last_recorded_game_id !== state.gameId) {
      for (const item of room.members.filter((item) =>
        state.participants.includes(item.player_id)
      )) {
        if (item.player_id === state.winnerId) {
          item.wins++
          item.current_streak++
          item.best_streak = Math.max(item.best_streak, item.current_streak)
        } else item.current_streak = 0
      }
      room.last_recorded_game_id = state.gameId
    }
    for (const item of room.members) item.game_start_balance = null
  }
}
export class Rooms {
  constructor(private database: pg.Pool) {}
  private async load(db: DbClient, id: string): Promise<Aggregate> {
    const { rows } = await db.query(
      'SELECT * FROM rooms WHERE id=$1 FOR UPDATE',
      [id]
    )
    invariant(rows[0], 'Room not found', 404)
    const memberships = await db.query(
      `SELECT m.*,p.display_name,
      ARRAY(SELECT skin_id FROM member_skins s WHERE s.membership_id=m.id) AS owned_skins,
      ARRAY(SELECT avatar_id FROM member_avatars a WHERE a.membership_id=m.id) AS owned_avatars
      FROM room_memberships m JOIN players p ON p.id=m.player_id WHERE m.room_id=$1 ORDER BY m.seat_index,m.joined_at`,
      [id]
    )
    const members: Membership[] = memberships.rows.map((item) => ({
      ...item,
      balance: Number(item.balance),
      wins: Number(item.wins),
      current_streak: Number(item.current_streak),
      best_streak: Number(item.best_streak),
      game_start_balance:
        item.game_start_balance == null
          ? null
          : Number(item.game_start_balance),
    }))
    const presence = await db.query(
      'SELECT player_id,room_id FROM live_sessions WHERE player_id=ANY($1::uuid[]) AND expires_at>clock_timestamp()',
      [members.map((item) => item.player_id)]
    )
    return { ...rows[0], members, presence: presence.rows }
  }
  private async save(db: DbClient, room: Aggregate, original: string) {
    if (room.deleted) {
      await db.query('DELETE FROM rooms WHERE id=$1', [room.id])
      return
    }
    if (JSON.stringify(room) === original) return
    for (const m of room.members) {
      await db.query(
        `INSERT INTO room_memberships(id,room_id,player_id,seat_index,balance,active,joined_at,equipped_skin,equipped_avatar,wins,current_streak,best_streak,game_start_balance)
        VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12)
        ON CONFLICT(id) DO UPDATE SET seat_index=EXCLUDED.seat_index,balance=EXCLUDED.balance,active=EXCLUDED.active,
          equipped_skin=EXCLUDED.equipped_skin,equipped_avatar=EXCLUDED.equipped_avatar,wins=EXCLUDED.wins,
          current_streak=EXCLUDED.current_streak,best_streak=EXCLUDED.best_streak,game_start_balance=EXCLUDED.game_start_balance`,
        [
          m.id,
          room.id,
          m.player_id,
          m.seat_index,
          m.balance,
          m.active,
          m.equipped_skin,
          m.equipped_avatar,
          m.wins,
          m.current_streak,
          m.best_streak,
          m.game_start_balance,
        ]
      )
      for (const skin of m.owned_skins)
        await db.query(
          'INSERT INTO member_skins VALUES($1,$2) ON CONFLICT DO NOTHING',
          [m.id, skin]
        )
      for (const avatar of m.owned_avatars)
        await db.query(
          'INSERT INTO member_avatars VALUES($1,$2) ON CONFLICT DO NOTHING',
          [m.id, avatar]
        )
    }
    await db.query(
      `UPDATE rooms SET name=$2,host_id=$3,status=$4,game_state=$5::jsonb,last_notice=$6,last_recorded_game_id=$7,version=version+1 WHERE id=$1`,
      [
        room.id,
        room.name,
        room.host_id,
        room.status,
        room.game_state ? JSON.stringify(room.game_state) : null,
        room.last_notice,
        room.last_recorded_game_id,
      ]
    )
  }
  private async withRoom<T>(
    id: string,
    action: (room: Aggregate, db: DbClient) => Promise<T> | T,
    advance = true
  ): Promise<T> {
    return transaction(this.database, async (db) => {
      const room = await this.load(db, id),
        original = JSON.stringify(room)
      if (advance && room.game_state?.phase === 'ACTIVE') {
        const before = { ...room.game_state.earnings },
          rules = engine(room.game_type)
        for (const player of [...room.game_state.order])
          if (
            !present(room, player) ||
            !room.members.some((m) => m.active && m.player_id === player)
          )
            rules.depart(room.game_state, player)
        rules.tick(room.game_state)
        settle(room, before)
      }
      const result = await action(room, db)
      await this.save(db, room, original)
      return result
    })
  }
  async aggregate(id: string): Promise<Aggregate> {
    return this.withRoom(id, (room) => room)
  }
  project(room: Aggregate, actor: Account): RoomView {
    requireAccess(room, actor)
    const own = room.members.find((m) => m.player_id === actor.id)
    return {
      id: room.id,
      name: room.name,
      gameType: room.game_type,
      hostId: room.host_id,
      status: room.status,
      players: room.members
        .filter((m) => m.active)
        .map((m) => ({
          id: m.player_id,
          displayName: m.display_name,
          identityTag: tag(m.player_id),
          seatIndex: m.seat_index,
          balance: m.balance,
          host: m.player_id === room.host_id,
          presence: present(room, m.player_id)
            ? 'ACTIVE'
            : room.presence.some((p) => p.player_id === m.player_id)
              ? 'AWAY'
              : 'OFFLINE',
          equippedSkin: m.equipped_skin,
          equippedAvatar: m.equipped_avatar,
        })),
      game: room.game_state
        ? engine(room.game_type).view(room.game_state, actor.id)
        : null,
      skins: engine(room.game_type).catalog.skins.map((s) => ({
        ...s,
        owned: s.price === 0 || Boolean(own?.owned_skins.includes(s.id)),
      })),
      avatars: engine(room.game_type).catalog.avatars.map((a) => ({
        ...a,
        owned: a.price === 0 || Boolean(own?.owned_avatars.includes(a.id)),
      })),
      records: room.members
        .map((m) => ({
          playerId: m.player_id,
          displayName: m.display_name,
          identityTag: tag(m.player_id),
          wins: m.wins,
          currentStreak: m.current_streak,
          bestStreak: m.best_streak,
        }))
        .sort(
          (a, b) => b.wins - a.wins || a.playerId.localeCompare(b.playerId)
        ),
      notice: room.last_notice,
    }
  }
  async view(id: string, actor: Account) {
    return this.project(await this.aggregate(id), actor)
  }
  async list(actor: Account): Promise<RoomSummary[]> {
    await this.database.query(
      "DELETE FROM live_sessions WHERE expires_at<clock_timestamp()-interval '1 day'"
    )
    // Lazy catch-up also recovers expired rooms after every function instance has gone idle.
    const active = await this.database.query(
      "SELECT id FROM rooms WHERE status='IN_GAME'"
    )
    for (const { id } of active.rows)
      await this.aggregate(id).catch((error) => {
        if (!(error instanceof AppError && error.status === 404)) throw error
      })
    const { rows } = await this.database.query(
      `SELECT r.*,
      (SELECT count(*) FROM room_memberships m WHERE m.room_id=r.id AND m.active) AS player_count,
      (SELECT count(DISTINCT s.player_id) FROM live_sessions s JOIN room_memberships m ON m.player_id=s.player_id AND m.room_id=s.room_id
        WHERE s.room_id=r.id AND s.expires_at>clock_timestamp() AND m.active) AS active_count,
      EXISTS(SELECT 1 FROM room_memberships m WHERE m.room_id=r.id AND m.player_id=$1 AND m.active) AS joined
      FROM rooms r ORDER BY r.created_at DESC`,
      [actor.id]
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      gameType: r.game_type,
      status: r.status,
      hostId: r.host_id,
      playerCount: Number(r.player_count),
      maxPlayers: 8,
      activePlayerCount: Number(r.active_count),
      createdAt: r.created_at.toISOString(),
      joined: r.joined,
    }))
  }
  private newMember(room: string, actor: Account, seat: number): Membership {
    return {
      id: randomUUID(),
      room_id: room,
      player_id: actor.id,
      display_name: actor.display_name,
      seat_index: seat,
      balance: 0,
      active: true,
      game_start_balance: null,
      equipped_skin: 'CLASSIC',
      equipped_avatar: 'DEFAULT',
      wins: 0,
      current_streak: 0,
      best_streak: 0,
      owned_skins: [],
      owned_avatars: [],
    }
  }
  async create(actor: Account, name: string | undefined, type: GameType) {
    engine(type)
    const id = randomUUID(),
      first = ['Velvet', 'Silver', 'Quiet', 'Secret', 'Midnight', 'Golden'],
      second = ['Saloon', 'Club', 'Cabaret', 'Hideaway', 'Lounge', 'Penthouse']
    const actual =
      name?.trim() ||
      `${first[randomInt(first.length)]} ${second[randomInt(second.length)]}`
    await transaction(this.database, async (db) => {
      await db.query(
        "INSERT INTO rooms(id,name,game_type,status,host_id,created_at) VALUES($1,$2,$3,'LOBBY',$4,now())",
        [id, actual, type, actor.id]
      )
      const m = this.newMember(id, actor, 0)
      await db.query(
        'INSERT INTO room_memberships(id,room_id,player_id,seat_index,joined_at) VALUES($1,$2,$3,0,now())',
        [m.id, id, actor.id]
      )
    })
    return this.view(id, actor)
  }
  async join(id: string, actor: Account) {
    await this.withRoom(id, (room) => {
      invariant(room.status === 'LOBBY', 'A game is already running')
      let m = room.members.find((m) => m.player_id === actor.id)
      if (m?.active) return
      const used = room.members.filter((m) => m.active).map((m) => m.seat_index)
      invariant(used.length < 8, 'This room is full')
      const seat = Array.from({ length: 8 }, (_, i) => i).find(
        (i) => !used.includes(i)
      )!
      if (m) {
        m.active = true
        m.seat_index = seat
      } else room.members.push((m = this.newMember(id, actor, seat)))
      if (!room.members.some((m) => m.active && m.player_id === room.host_id))
        room.host_id = actor.id
    })
    return this.view(id, actor)
  }
  async delete(id: string, actor: Account) {
    await this.withRoom(
      id,
      (room) => {
        requireModerator(room, actor)
        room.deleted = true
      },
      false
    )
  }
  async kick(id: string, actor: Account, target: string) {
    await this.withRoom(id, async (room, db) => {
      requireModerator(room, actor)
      invariant(
        target !== actor.id || actor.root_account,
        'The host cannot kick themselves',
        403
      )
      member(room, target).active = false
      await db.query(
        'UPDATE live_sessions SET room_id=NULL WHERE room_id=$1 AND player_id=$2',
        [id, target]
      )
      if (room.game_state) {
        const before = { ...room.game_state.earnings }
        engine(room.game_type).depart(room.game_state, target)
        settle(room, before)
      }
      if (room.host_id === target)
        room.host_id =
          room.members.find((m) => m.active)?.player_id ?? room.host_id
    })
  }
  async start(id: string, actor: Account, settings: StartSettings) {
    await this.withRoom(id, async (room, db) => {
      invariant(room.host_id === actor.id, 'Only the host can do that', 403)
      invariant(room.status !== 'IN_GAME', 'A game is already running')
      const roster = room.members.filter(
        (m) => m.active && present(room, m.player_id)
      )
      invariant(
        roster.length >= 2,
        'At least two players must be online inside this room before dealing'
      )
      const state = engine(room.game_type).start(
        id,
        roster.map((m) => m.player_id),
        settings
      )
      for (const m of room.members)
        m.game_start_balance = roster.includes(m) ? m.balance : null
      room.game_state = state
      room.status = 'IN_GAME'
      room.last_notice = null
      await db.query('DELETE FROM game_commands WHERE room_id=$1', [id])
    })
    return this.view(id, actor)
  }
  async stop(id: string, actor: Account, gameId: string | null) {
    await this.withRoom(
      id,
      (room) => {
        requireModerator(room, actor)
        invariant(
          !room.game_state || room.game_state.gameId === gameId,
          'The deal changed. Review the current table before stopping it'
        )
        balanceRestore(room)
        room.game_state = null
        room.status = 'LOBBY'
        room.last_notice = `Deal stopped by ${actor.display_name} #${tag(actor.id)}. Every room wallet was restored to its pre-deal balance. Rankings unchanged.`
      },
      false
    )
    return this.view(id, actor)
  }
  async command(actor: Account, command: GameCommand) {
    await this.withRoom(command.roomId, async (room, db) => {
      invariant(present(room, actor.id), 'Enter the room before playing')
      member(room, actor.id)
      invariant(
        room.game_state?.phase === 'ACTIVE',
        'No active game in this room'
      )
      invariant(
        !command.gameId || command.gameId === room.game_state.gameId,
        'The deal changed; refresh the table before playing'
      )
      if (command.requestId) {
        const result = await db.query(
          'INSERT INTO game_commands(room_id,player_id,request_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_id',
          [room.id, actor.id, command.requestId]
        )
        if (!result.rowCount) return
      }
      const before = { ...room.game_state.earnings }
      engine(room.game_type).command(room.game_state, actor.id, command)
      settle(room, before)
    })
  }
  async cosmetic(
    id: string,
    actor: Account,
    kind: 'skins' | 'avatars',
    key: string,
    purchase: boolean
  ) {
    await this.withRoom(id, (room) => {
      const m = member(room, actor.id),
        catalog = engine(room.game_type).catalog[kind]
      const item = catalog.find((item) => item.id === key)
      invariant(item, 'Unknown cosmetic', 400)
      const owned = kind === 'skins' ? m.owned_skins : m.owned_avatars
      if (item.price > 0 && !owned.includes(key)) {
        invariant(purchase, 'Unlock this item first')
        invariant(room.status !== 'IN_GAME', 'Unlock new items between deals')
        invariant(m.balance >= item.price, 'Not enough room coins')
        m.balance -= item.price
        owned.push(key)
      }
      if (kind === 'skins') m.equipped_skin = key as SkinId
      else m.equipped_avatar = key as AvatarId
    })
    return this.view(id, actor)
  }
  async authenticateSession(id: string, connectionId: string, actor: Account) {
    const previous = await this.database.query(
      'SELECT * FROM live_sessions WHERE id=$1',
      [id]
    )
    const session = previous.rows[0]
    invariant(
      !session || session.player_id === actor.id,
      'This live session belongs to another identity',
      403
    )
    if (session && new Date(session.expires_at).getTime() <= Date.now())
      await this.disconnect(id, session.connection_id)
    const result = await this.database.query(
      `INSERT INTO live_sessions(id,connection_id,player_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond')
      ON CONFLICT(id) DO UPDATE SET connection_id=EXCLUDED.connection_id,expires_at=EXCLUDED.expires_at
      WHERE live_sessions.player_id=EXCLUDED.player_id RETURNING id`,
      [id, connectionId, actor.id, PRESENCE_TTL_MS]
    )
    invariant(
      result.rowCount,
      'This live session belongs to another identity',
      403
    )
  }
  async heartbeat(id: string, connectionId: string) {
    const result = await this.database.query(
      `UPDATE live_sessions SET expires_at=clock_timestamp()+$3*interval '1 millisecond'
      WHERE id=$1 AND connection_id=$2 AND expires_at>clock_timestamp()`,
      [id, connectionId, PRESENCE_TTL_MS]
    )
    invariant(result.rowCount, 'This live session has expired', 401)
  }
  async enter(
    id: string,
    connectionId: string,
    roomId: string,
    actor: Account
  ) {
    // Never hold locks on two rooms at once when moving between tables.
    const target = await this.aggregate(roomId)
    requireAccess(target, actor)
    const previous = await this.database.query(
      'SELECT room_id FROM live_sessions WHERE id=$1 AND connection_id=$2',
      [id, connectionId]
    )
    invariant(previous.rows[0], 'Authenticate this connection first', 401)
    if (previous.rows[0].room_id && previous.rows[0].room_id !== roomId)
      await this.leave(id, connectionId)
    await this.withRoom(roomId, async (room, db) => {
      requireAccess(room, actor)
      const result = await db.query(
        'UPDATE live_sessions SET room_id=$3 WHERE id=$1 AND connection_id=$2 AND expires_at>clock_timestamp()',
        [id, connectionId, roomId]
      )
      invariant(result.rowCount, 'This live session has expired', 401)
    })
  }
  async leave(id: string, connectionId: string) {
    const { rows } = await this.database.query(
      `WITH previous AS MATERIALIZED (
      SELECT id,room_id,player_id FROM live_sessions WHERE id=$1 AND connection_id=$2 FOR UPDATE)
      UPDATE live_sessions s SET room_id=NULL FROM previous p WHERE s.id=p.id RETURNING p.room_id,p.player_id`,
      [id, connectionId]
    )
    if (rows[0]?.room_id)
      await this.aggregate(rows[0].room_id).catch((error) => {
        if (!(error instanceof AppError && error.status === 404)) throw error
      })
    return rows[0]?.room_id as string | undefined
  }
  async disconnect(id: string, connectionId: string) {
    const { rows } = await this.database.query(
      'DELETE FROM live_sessions WHERE id=$1 AND connection_id=$2 RETURNING room_id,player_id',
      [id, connectionId]
    )
    if (rows[0]?.room_id)
      await this.aggregate(rows[0].room_id).catch((error) => {
        if (!(error instanceof AppError && error.status === 404)) throw error
      })
  }
}
