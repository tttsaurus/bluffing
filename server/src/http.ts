import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { readFileSync, existsSync, createReadStream } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import type pg from 'pg'
import { z, ZodError } from 'zod'
import { pool } from './db.ts'
import { Identities, isLocalRoot } from './identity.ts'
import { Rooms } from './rooms.ts'
import { Realtime } from './realtime.ts'
import { AppError, invariant } from './errors.ts'
import { audioSources, directory } from './game/words.ts'
import * as v from './validation.ts'
import { pronunciation } from './audio.ts'

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += chunk.length
    invariant(size <= 32 * 1024, 'Request body is too large', 413)
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new AppError(400, 'Invalid JSON request')
  }
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(status === 204 ? undefined : JSON.stringify(value))
}
function originAllowed(origin: string) {
  try {
    const host = new URL(origin).hostname
    return (
      ['localhost', '127.0.0.1', '[::1]'].includes(host) ||
      host.endsWith('.ts.net')
    )
  } catch {
    return false
  }
}
export function createApplication(
  database?: pg.Pool,
  options: { staticFiles?: boolean } = {}
) {
  // Pool construction is lazy at module import; builds never need a live database.
  const db = database ?? pool(),
    identities = new Identities(db),
    rooms = new Rooms(db)
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      if (error instanceof ZodError)
        json(response, 400, {
          message: error.issues
            .map((item) => `${item.path.join('.')}: ${item.message}`)
            .join('; '),
        })
      else if (error instanceof AppError)
        json(response, error.status, { message: error.message })
      else {
        console.error('Request failed', error)
        json(response, 500, {
          message: 'The server could not complete this request',
        })
      }
    })
  })
  const realtime = new Realtime(server, identities, rooms)
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? '/', 'http://server.invalid').pathname,
      method = request.method ?? 'GET'
    response.setHeader('Referrer-Policy', 'same-origin')
    if (
      request.headers.origin &&
      originAllowed(request.headers.origin) &&
      !process.env.VERCEL
    ) {
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
      response.setHeader('Vary', 'Origin')
      response.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,X-Bluff-Root-Claim,X-Bluff-Proxied'
      )
      response.setHeader(
        'Access-Control-Allow-Methods',
        'GET,POST,PATCH,PUT,DELETE,OPTIONS'
      )
    }
    if (method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    if (path === '/api/health') {
      await db.query('SELECT 1')
      json(response, 200, {
        status: 'ok',
        backend: 'typescript',
        database: 'postgresql',
      })
      return
    }
    if (path === '/api/spelling/credits') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      })
      response.end(readFileSync(resolve(directory, 'credits.html')))
      return
    }
    if (path.startsWith('/api/spelling/audio/')) {
      const id = path.slice('/api/spelling/audio/'.length),
        source = audioSources.get(id)
      invariant(source, 'Unknown pronunciation', 404)
      // Vercel's read-only runtime needs no disk cache: immutable, allowlisted audio is CDN-cacheable.
      const audio = await pronunciation(id)
      response.writeHead(200, {
        'Content-Type': source.url.endsWith('.mp3')
          ? 'audio/mpeg'
          : source.url.endsWith('.wav')
            ? 'audio/wav'
            : 'audio/ogg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(audio)
      return
    }
    if (path === '/api/players' && method === 'POST') {
      const value = v.identify.parse(await body(request))
      json(
        response,
        200,
        await identities.restore(
          value.displayName,
          value.deviceToken,
          isLocalRoot(request.socket.remoteAddress, request.headers),
          value.legacyPlayerId
        )
      )
      return
    }
    if (path.startsWith('/api/')) {
      const actor = await identities.authorization(
        request.headers.authorization
      )
      if (path === '/api/players/me') {
        if (method === 'GET') {
          const { playerView } = await import('./identity.ts')
          json(response, 200, playerView(actor))
          return
        }
        if (method === 'PATCH') {
          const value = v.rename.parse(await body(request))
          json(response, 200, await identities.rename(actor, value.displayName))
          return
        }
      }
      if (path === '/api/players/me/debug-identity' && method === 'POST') {
        json(response, 200, await identities.debug(actor))
        return
      }
      if (path === '/api/rooms') {
        if (method === 'GET') {
          json(response, 200, await rooms.list(actor))
          return
        }
        if (method === 'POST') {
          const value = v.createRoom.parse(await body(request))
          json(
            response,
            201,
            await rooms.create(actor, value.name, value.gameType)
          )
          return
        }
      }
      const match = /^\/api\/rooms\/([^/]+)(?:\/(.*))?$/.exec(path)
      if (match) {
        const id = v.uuid.parse(match[1]),
          action = match[2] ?? ''
        if (!action && method === 'DELETE') {
          await rooms.delete(id, actor)
          await realtime.refresh(id)
          json(response, 204, null)
          return
        }
        if (action === 'snapshot' && method === 'GET') {
          json(response, 200, await rooms.view(id, actor))
          return
        }
        let result: unknown
        if (action === 'join' && method === 'POST')
          result = await rooms.join(id, actor)
        else if (action === 'start' && method === 'POST')
          result = await rooms.start(
            id,
            actor,
            v.startGame.parse(await body(request))
          )
        else if (action === 'stop' && method === 'POST')
          result = await rooms.stop(
            id,
            actor,
            v.stopGame.parse(await body(request)).gameId
          )
        else if (action.startsWith('players/') && method === 'DELETE') {
          await rooms.kick(id, actor, v.uuid.parse(action.slice(8)))
          await realtime.refresh(id)
          json(response, 204, null)
          return
        } else if (/^(skins|avatars)\/(purchase|equip)$/.test(action)) {
          const [kind, operation] = action.split('/') as [
            'skins' | 'avatars',
            'purchase' | 'equip',
          ]
          invariant(
            method === (operation === 'purchase' ? 'POST' : 'PUT'),
            'Method not allowed',
            405
          )
          const value = z
            .object({
              skinId: z.string().max(32).optional(),
              avatarId: z.string().max(32).optional(),
            })
            .parse(await body(request))
          result = await rooms.cosmetic(
            id,
            actor,
            kind,
            (kind === 'skins' ? value.skinId : value.avatarId) ?? '',
            operation === 'purchase'
          )
        } else throw new AppError(404, 'Endpoint not found')
        await realtime.refresh(id)
        json(response, 200, result)
        return
      }
      throw new AppError(404, 'Endpoint not found')
    }
    if (options.staticFiles && method === 'GET') {
      const root = resolve(process.cwd(), 'frontend/dist'),
        target = resolve(root, `.${decodeURIComponent(path)}`)
      invariant(
        target.startsWith(`${root}${sep}`) || target === root,
        'Invalid path',
        400
      )
      const file =
        existsSync(target) && extname(target)
          ? target
          : resolve(root, 'index.html')
      if (existsSync(file)) {
        const types: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.jpg': 'image/jpeg',
          '.webp': 'image/webp',
          '.ico': 'image/x-icon',
        }
        response.writeHead(200, {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': path.startsWith('/assets/')
            ? 'public,max-age=31536000,immutable'
            : 'no-cache',
        })
        createReadStream(file).pipe(response)
        return
      }
    }
    json(response, 404, { message: 'Not found' })
  }
  return { server, realtime, rooms, identities, database: db }
}
