import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { rankRecords, tableSkins, gameWallet, turnOrder, outcomeCopy, freshOutcomes, shouldNotifyOutcome } from '../src/presentation.ts'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '({})')
const code = stripTypeScriptTypes(source)
  .replace("import { create } from 'zustand'", "const { create } = require('zustand')")
  .replace('export const useGameStore =', 'const useGameStore = exports.useGameStore =')
const player = {id:'p1', displayName:'Tester', identityTag:'abcde', root:false}
const room = {id:'room1', players:[], game:null}
function fixture(seed = {}) {
  const sockets = [], requests = [], history = []
  const scheduled = new Map()
  let timerId = 0
  const local = new Map(Object.entries(seed.local ?? {})), session = new Map(Object.entries(seed.session ?? {}))
  const storage = values => ({ getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value), removeItem:key => values.delete(key) })
  class Socket {
    static OPEN = 1
    readyState = 0
    sent = []
    constructor() { sockets.push(this) }
    send(value) { this.sent.push(JSON.parse(value)) }
    open() { this.readyState = 1; this.onopen?.() }
    close() { this.readyState = 3; this.onclose?.({code:1000}) }
    emit(type, payload) { this.onmessage?.({data:JSON.stringify({type,payload})}) }
  }
  const context = vm.createContext({
    exports:{}, require, crypto, btoa, queueMicrotask, AbortController,
    localStorage:storage(local), sessionStorage:storage(session),
    location:{protocol:'http:',host:'qa.test',hostname:'qa.test'},
    WebSocket:Socket, window:{
      setTimeout:(fn, delay) => { const id = ++timerId; scheduled.set(id, {fn,delay}); return id },
      clearTimeout:id => scheduled.delete(id),
    },
    fetch:(path, options) => new Promise((resolve,reject) => {
      const request = {path,options,resolve,reject}
      requests.push(request); history.push(request)
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true})
    }),
  })
  vm.runInContext(code, context)
  const store = context.exports.useGameStore
  async function respond(path, value) {
    const index = requests.findIndex(request => request.path === path)
    assert.notEqual(index,-1,`No request for ${path}`)
    requests.splice(index,1)[0].resolve({ok:true,status:200,json:async()=>value})
    await new Promise(resolve => setImmediate(resolve))
  }
  async function reject(path) {
    const index = requests.findIndex(request => request.path === path)
    assert.notEqual(index,-1,`No request for ${path}`)
    requests.splice(index,1)[0].reject(new Error('Request failed'))
    await new Promise(resolve => setImmediate(resolve))
  }
  async function identify(authenticated = true) {
    const pending = store.getState().identify('Tester')
    await respond('/api/players', player)
    await respond('/api/rooms', [])
    await pending
    sockets.at(-1).open()
    if (authenticated) sockets.at(-1).emit('CONNECTED', {playerId:player.id})
  }
  function runTimer(delay) {
    const entry = [...scheduled].find(([,timer])=>timer.delay===delay)
    assert.ok(entry,`No timer scheduled for ${delay}ms`)
    scheduled.delete(entry[0]); entry[1].fn()
  }
  return {store, sockets, local, session, get timers(){return [...scheduled.values()].map(timer=>timer.fn)}, requests, history, respond, reject, identify, runTimer}
}

test('root debug switching is tab-local, retires sockets, and restores root without replacing its stored identity', async () => {
  const f = fixture(); await f.identify()
  const root = { ...player, root:true }
  f.store.setState({player:root})
  f.local.set('bluff-table-player',JSON.stringify(root))
  const rootToken = f.local.get('bluff-table-device-token')
  const oldSocket = f.sockets[0]
  const lateRoomUpdate = f.store.getState().loadRooms()
  const switching = f.store.getState().switchIdentity()
  const bot = {...player,id:'bot-id',displayName:'Debug bot',root:false}
  const token = 'debug-bot-credential-with-more-than-thirty-two-chars'
  await f.respond('/api/players/me/debug-identity',{player:bot,deviceToken:token})
  await f.respond('/api/rooms',[{id:'old-root-response'}])
  await lateRoomUpdate
  assert.equal(f.store.getState().rooms.length,0)
  await f.respond('/api/rooms',[])
  await switching
  assert.equal(oldSocket.readyState,3)
  assert.equal(f.store.getState().debugMode,true)
  assert.equal(JSON.parse(f.local.get('bluff-table-player')).id,root.id)
  assert.equal(f.local.get('bluff-table-device-token'),rootToken)
  f.sockets.at(-1).open()
  assert.equal(f.sockets.at(-1).sent[0].payload.deviceToken,token)
  const back = f.store.getState().switchIdentity()
  assert.equal(f.requests.find(r=>r.path==='/api/players/me').options.headers.Authorization,`Bearer ${rootToken}`)
  await f.respond('/api/players/me',root)
  await f.respond('/api/rooms',[])
  await back
  assert.equal(f.store.getState().debugMode,false)
  assert.equal(f.session.size,0)
})

test('non-root accounts and players inside a room cannot switch identity', async () => {
  const f = fixture(); await f.identify()
  await f.store.getState().switchIdentity()
  assert.equal(f.requests.length,0)
  f.store.setState({player:{...player,root:true},room})
  await f.store.getState().switchIdentity()
  assert.equal(f.requests.length,0)
})

test('reloading a debug tab authenticates the bot without registration or a root claim', async () => {
  const root = {...player,root:true}
  const bot = {...player,id:'bot-id',displayName:'Debug bot'}
  const token = 'debug-bot-credential-with-more-than-thirty-two-chars'
  const f = fixture({local:{'bluff-table-player':JSON.stringify(root),'bluff-table-device-token':'root-device-token-with-more-than-thirty-two-chars'},
    session:{'bluff-table-debug-identity':JSON.stringify({rootId:root.id,player:bot,token})}})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests[0].path,'/api/players/me')
  assert.equal(f.requests[0].options.headers.Authorization,`Bearer ${token}`)
  assert.equal(f.requests[0].options.headers['X-Bluff-Root-Claim'],undefined)
  await f.respond('/api/players/me',bot)
  await f.respond('/api/rooms',[])
  assert.equal(f.store.getState().debugMode,true)
  assert.equal(f.store.getState().player.id,bot.id)
  assert.equal(JSON.parse(f.local.get('bluff-table-player')).id,root.id)
  const rename = f.store.getState().renamePlayer('Test bot')
  await f.respond('/api/players/me',{...bot,displayName:'Test bot'})
  await rename
  assert.equal(JSON.parse(f.session.get('bluff-table-debug-identity')).player.displayName,'Test bot')
  assert.equal(JSON.parse(f.local.get('bluff-table-player')).displayName,root.displayName)
})

test('creating a table works while live authentication is pending and syncs after it connects', async () => {
  const f = fixture(); await f.identify(false)
  const creating = f.store.getState().createRoom('Test table')
  await f.store.getState().createRoom('Duplicate click')
  assert.equal(f.history.filter(r=>r.path==='/api/rooms' && r.options.method==='POST').length,1)
  await f.respond('/api/rooms',room)
  await f.respond('/api/rooms',[])
  await creating
  assert.equal(f.store.getState().room.id,room.id)
  assert.equal(f.store.getState().connected,false)
  assert.equal(f.sockets[0].sent.filter(m=>m.type==='SYNC_ROOM').length,0)
  f.sockets[0].emit('CONNECTED',{playerId:player.id})
  assert.equal(f.sockets[0].sent.filter(m=>m.type==='SYNC_ROOM').length,1)
})

test('room creation sends the selected Plus game type instead of hardcoding Classic', async () => {
  const f = fixture(); await f.identify()
  const creating = f.store.getState().createRoom('Plus table', 'LIARS_DECK_PLUS')
  const request = f.requests.find(r => r.path === '/api/rooms')
  assert.equal(JSON.parse(request.options.body).gameType, 'LIARS_DECK_PLUS')
  await f.respond('/api/rooms', { ...room, gameType: 'LIARS_DECK_PLUS' })
  await f.respond('/api/rooms', [])
  await creating
  assert.equal(f.store.getState().room.gameType, 'LIARS_DECK_PLUS')
})

test('random decks are a per-game request and do not change the room type', async () => {
  const f = fixture(); await f.identify(); f.store.setState({ room: { ...room, gameType: 'LIARS_DECK_PLUS' } })
  const starting = f.store.getState().startGame(1, null, true)
  const request = f.requests.find(r => r.path === '/api/rooms/room1/start')
  assert.deepEqual(JSON.parse(request.options.body), { deckCount: 1, cardsPerPlayer: null, randomDeckCount: true })
  await f.respond('/api/rooms/room1/start', { ...room, game: { deckCount: 2 } })
  await starting
  assert.equal(f.store.getState().room.gameType, 'LIARS_DECK_PLUS')
})

test('joining works during a disconnect and enters the room after automatic reconnect', async () => {
  const f = fixture(); await f.identify(); f.sockets[0].close()
  const joining = f.store.getState().joinRoom(room.id)
  await f.respond(`/api/rooms/${room.id}/join`,room)
  await f.respond('/api/rooms',[])
  await joining
  assert.equal(f.store.getState().loading,false)
  f.runTimer(1600)
  f.sockets[1].open(); f.sockets[1].emit('CONNECTED',{playerId:player.id})
  assert.equal(f.store.getState().connected,true)
  assert.deepEqual(f.sockets[1].sent.find(m=>m.type==='SYNC_ROOM').payload,{roomId:room.id})
})

test('an open socket that never authenticates times out and gets replaced', async () => {
  const f = fixture(); await f.identify(false)
  const obsoleteClose = f.sockets[0].onclose
  f.runTimer(12000)
  assert.equal(f.sockets[0].readyState,3)
  assert.equal(f.store.getState().connected,false)
  obsoleteClose({code:1006})
  assert.equal(f.timers.length,1)
  f.runTimer(1600)
  f.sockets[1].open(); f.sockets[1].emit('CONNECTED',{playerId:player.id})
  assert.equal(f.store.getState().connected,true)
  assert.equal(f.timers.length,0)
})

test('a handshake stuck in CONNECTING also times out without waiting for a browser close event', async () => {
  const f = fixture(); await f.identify(false)
  f.sockets[0].readyState=0
  f.runTimer(12000)
  assert.equal(f.sockets[0].readyState,3)
  f.runTimer(1600)
  assert.equal(f.sockets.length,2)
})

test('socket errors reconnect even when no close event arrives', async () => {
  const f = fixture(); await f.identify(false)
  f.sockets[0].onerror({})
  assert.equal(f.sockets[0].readyState,3)
  f.runTimer(1600)
  assert.equal(f.sockets.length,2)
})

test('manual retry cancels the old retry instead of spawning competing sockets', async () => {
  const f = fixture(); await f.identify()
  f.sockets[0].close()
  f.store.getState().reconnect()
  assert.equal(f.sockets.length,2)
  f.sockets[1].open(); f.sockets[1].emit('CONNECTED',{playerId:player.id})
  assert.equal(f.timers.length,0)
  f.store.getState().reconnect() // A healthy live deal must never be disconnected by a retry.
  assert.equal(f.sockets.length,2)
})

test('rejected socket auth restores the same device credential before retrying', async () => {
  const f = fixture(); await f.identify(false)
  const token = JSON.parse(f.history.find(r=>r.path==='/api/players').options.body).deviceToken
  f.sockets[0].emit('ERROR',{message:'This device identity is not recognized'})
  const restoring = f.requests.find(r=>r.path==='/api/players')
  assert.equal(JSON.parse(restoring.options.body).deviceToken,token)
  assert.equal(JSON.parse(restoring.options.body).legacyPlayerId,player.id)
  await f.respond('/api/players',player)
  f.runTimer(1600)
  f.sockets[1].open(); f.sockets[1].emit('CONNECTED',{playerId:player.id})
  assert.equal(f.store.getState().player.id,player.id)
  assert.equal(f.store.getState().connected,true)
})

test('malformed live messages cannot leave a socket silently stuck', async () => {
  const f = fixture(); await f.identify()
  f.sockets[0].onmessage({data:'not JSON'})
  assert.equal(f.store.getState().connected,false)
  f.runTimer(1600)
  assert.equal(f.sockets.length,2)
})

test('a stalled room request releases loading and does not automatically duplicate a POST', async () => {
  const f = fixture(); await f.identify()
  const creating = f.store.getState().createRoom('Test table')
  f.runTimer(12000)
  await creating
  assert.equal(f.store.getState().loading,false)
  assert.match(f.store.getState().error,/too long to respond/)
  assert.equal(f.history.filter(r=>r.path==='/api/rooms' && r.options.method==='POST').length,1)
})

test('a late failed navigation cannot unlock or overwrite a newer join', async () => {
  const f = fixture(); await f.identify()
  const obsolete = f.store.getState().openRoom('old-room')
  f.store.getState().leaveRoom()
  await f.respond('/api/rooms',[])
  const joining = f.store.getState().joinRoom(room.id)
  await f.reject('/api/rooms/old-room/snapshot')
  await obsolete
  assert.equal(f.store.getState().loading,true)
  assert.equal(f.store.getState().error,null)
  await f.respond(`/api/rooms/${room.id}/join`,room)
  await f.respond('/api/rooms',[])
  await joining
  assert.equal(f.store.getState().room.id,room.id)
})

test('an unauthenticated open socket cannot send game commands', async () => {
  const f = fixture(); await f.identify(false)
  f.store.setState({room})
  f.store.getState().command('FOLD')
  assert.equal(f.sockets[0].sent.filter(m=>m.type==='GAME_COMMAND').length,0)
  assert.match(f.store.getState().error,/not ready/)
})

test('late snapshots cannot reopen a room after leaving', async () => {
  const f = fixture(); await f.identify()
  f.store.setState({room})
  f.store.getState().leaveRoom()
  f.sockets[0].emit('ROOM_STATE', room)
  assert.equal(f.store.getState().room, null)
})

test('leaving cancels an in-flight room navigation', async () => {
  const f = fixture(); await f.identify()
  const opening = f.store.getState().openRoom('room1')
  f.store.getState().leaveRoom()
  await f.respond('/api/rooms/room1/snapshot',room)
  await opening
  assert.equal(f.store.getState().room,null)
  assert.equal(f.sockets[0].sent.filter(m=>m.type === 'SYNC_ROOM').length,0)
})

test('a late start response cannot reopen the room or overwrite a newer socket state', async () => {
  const f = fixture(); await f.identify(); f.store.setState({room})
  const starting = f.store.getState().startGame(1,5)
  f.store.getState().leaveRoom()
  await f.respond('/api/rooms/room1/start',{...room,game:{phase:'ACTIVE'}})
  await starting
  assert.equal(f.store.getState().room,null)
})

test('closing an obsolete socket cannot create a reconnect loop', async () => {
  const f = fixture(); await f.identify()
  const obsolete = f.sockets[0]
  await f.identify()
  obsolete.close()
  assert.equal(f.timers.length,0)
  assert.equal(f.store.getState().connected,true)
})

test('serverless transport reconnect preserves the deal and reuses its live-session lease', async () => {
  const f = fixture(); await f.identify()
  f.store.setState({room:{...room,game:{phase:'ACTIVE'}}})
  f.sockets[0].close()
  assert.equal(f.store.getState().room.id,room.id)
  const session=f.sockets[0].sent.find(m=>m.type==='AUTH').payload.sessionId
  f.timers[0]()
  f.sockets[1].open();f.sockets[1].emit('CONNECTED',{playerId:player.id})
  assert.equal(f.sockets[1].sent.find(m=>m.type==='AUTH').payload.sessionId,session)
  assert.equal(f.sockets[1].sent.filter(m=>m.type === 'SYNC_ROOM').length,1)
})

test('server rejection removes the selected room and displays the reason', async () => {
  const f = fixture(); await f.identify(); f.store.setState({room})
  f.sockets[0].emit('ROOM_REJECTED',{roomId:room.id,message:'Wait for the next deal'})
  assert.equal(f.store.getState().room,null)
  assert.equal(f.store.getState().error,'Wait for the next deal')
})

test('lobby has one entrance transition, not a second per-card entrance', () => {
  const app = readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  const lobbyCard = app.slice(app.indexOf('function RoomCard('),app.indexOf('function Room()'))
  assert.match(lobbyCard, /<article className="room-card">/)
  assert.doesNotMatch(lobbyCard, /initial=|animate=/)
  assert.doesNotMatch(lobbyCard, /status status-|timeAgo|Created /)
  assert.doesNotMatch(app.slice(0,app.indexOf('function DeviceCheck')), /AnimatePresence mode="wait"/)
})

test('tied ranks share places without mutating records', () => {
  const records = [{playerId:'a',wins:5,bestStreak:2},{playerId:'b',wins:5,bestStreak:4},{playerId:'c',wins:3,bestStreak:3},{playerId:'d',wins:0,bestStreak:0}]
  assert.deepEqual(rankRecords(records,'wins').map(r=>r.rank),[1,1,3])
  assert.deepEqual(rankRecords(records,'bestStreak').map(r=>r.playerId),['b','c','a'])
  assert.equal(records.length,4)
  assert.equal(records[0].playerId,'a')
})

test('the turn edition and last-play card backs belong to different players', () => {
  const snapshot = {players:[{id:'a',equippedSkin:'AURORA'},{id:'b',equippedSkin:'PRISM'}],game:{currentPlayerId:'b',lastClaim:{playerId:'a'}}}
  assert.deepEqual(tableSkins(snapshot),{turn:'PRISM',pool:'AURORA'})
  snapshot.players[0].equippedSkin = 'SUPERNOVA'
  assert.deepEqual(tableSkins(snapshot),{turn:'PRISM',pool:'SUPERNOVA'})
  snapshot.game.lastClaim = null
  assert.deepEqual(tableSkins(snapshot),{turn:'PRISM',pool:'PRISM'})
})

test('stop sends the confirmed game ID and ignores its stale HTTP response after navigation', async () => {
  const f = fixture(); await f.identify(); f.store.setState({room})
  const stopping = f.store.getState().stopGame('confirmed-game')
  assert.deepEqual(JSON.parse(f.requests.find(r=>r.path.endsWith('/stop')).options.body),{gameId:'confirmed-game'})
  f.store.getState().leaveRoom()
  await f.respond('/api/rooms/room1/stop',room)
  assert.equal(await stopping,true)
  assert.equal(f.store.getState().room,null)
})

test('game wallet never counts pending rewards and tracks confirmed earnings independently of spending', () => {
  const game = {earnings:[{playerId:'a',amount:50}],pendingClaim:{playerId:'a',risk:30}}
  assert.deepEqual(gameWallet(game,'a'),{earned:50,pending:30})
  assert.deepEqual(gameWallet(game,'b'),{earned:0,pending:0})
  game.pendingClaim = null
  assert.deepEqual(gameWallet(game,'a'),{earned:50,pending:0})
})

test('round seats stay fixed as the indicator wraps and departed seats are removed', () => {
  const game = {currentPlayerId:'b',participants:['a','b','c'],hands:[{playerId:'a'},{playerId:'b'},{playerId:'c'}]}
  assert.deepEqual(turnOrder(game).map(p=>[p.playerId,p.ahead,p.seat]),[['a',2,1],['b',0,2],['c',1,3]])
  game.currentPlayerId = 'c'
  assert.deepEqual(turnOrder(game).map(p=>[p.playerId,p.ahead]),[['a',1],['b',2],['c',0]])
  game.currentPlayerId = 'a'
  assert.deepEqual(turnOrder(game).map(p=>[p.playerId,p.ahead]),[['a',0],['b',1],['c',2]])
  game.hands.splice(1,1)
  assert.deepEqual(turnOrder(game).map(p=>[p.playerId,p.seat,p.ahead]),[['a',1,0],['c',3,1]])
  game.currentPlayerId = null
  assert.deepEqual(turnOrder(game),[])
})

test('check results distinguish the challenger and defender without claiming both won', () => {
  const result = {type:'CHECK_FAILED',playerId:'a',challengerId:'b',poolSize:4}
  assert.equal(outcomeCopy(result,'b',id=>id).title,'Truth Check lost!')
  assert.equal(outcomeCopy(result,'b',id=>id).tone,'loss')
  assert.equal(outcomeCopy(result,'a',id=>id).title,'Truth defended!')
  result.type = 'CHECK_SUCCEEDED'
  assert.equal(outcomeCopy(result,'b',id=>id).title,'Truth Check won!')
  assert.equal(outcomeCopy(result,'a',id=>id).title,'Caught bluffing!')
  assert.equal(outcomeCopy(result,'a',id=>id).tone,'loss')
})

test('passed receipts never disclose whether an unchallenged play was a lie', () => {
  const copy = outcomeCopy({type:'PLAY_PASSED',playerId:'a'},'a',id=>id)
  assert.equal(copy.title,'Your play passed!')
  assert.doesNotMatch(JSON.stringify(copy),/bluff|lie|truth/i)
})

test('receipt sequences deduplicate snapshots but retain multiple payouts in one update', () => {
  const events = [{id:1},{id:2},{id:3}]
  assert.deepEqual(freshOutcomes(events,1).map(e=>e.id),[2,3])
  assert.deepEqual(freshOutcomes(events,3),[])
  assert.deepEqual(freshOutcomes([{id:2}],3),[])
})

test('payout overlays are private while direct Truth Check verdicts remain visible', () => {
  const passed = {type:'PLAY_PASSED',playerId:'a',rewardPlayerId:'a',challengerId:null}
  assert.equal(shouldNotifyOutcome(passed,'a'),true)
  assert.equal(shouldNotifyOutcome(passed,'b'),false)
  const failedCheck = {type:'CHECK_FAILED',playerId:'a',challengerId:'b',rewardPlayerId:'a'}
  assert.equal(shouldNotifyOutcome(failedCheck,'a'),true)
  assert.equal(shouldNotifyOutcome(failedCheck,'b'),true)
  assert.equal(shouldNotifyOutcome(failedCheck,'c'),false)
})

test('waiting room never renders game wallets or payout overlay', () => {
  const app = readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  const waiting = app.slice(app.indexOf('function WaitingRoom()'),app.indexOf('function PlayerRow('))
  assert.doesNotMatch(waiting,/Wallets|RoundFeedback|event-log/)
  const table = app.slice(app.indexOf('function GameTable('),app.indexOf('function PlayingCard('))
  assert.match(table,/<Wallets /)
  assert.match(table,/<RoundFeedback \/>/)
})

test('game setup is rendered only for the room host', () => {
  const app = readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  const waiting = app.slice(app.indexOf('function WaitingRoom()'),app.indexOf('function PlayerRow('))
  assert.match(waiting,/\{isHost && <section className="setup-panel panel" aria-label="Game setup">/)
  assert.doesNotMatch(waiting,/WAITING FOR HOST/)
})

test('an overflowing hand stays left-scrollable without clipping its first card', () => {
  const css = readFileSync(new URL('../src/styles.css',import.meta.url),'utf8')
  assert.match(css,/\.cards-track \{[^}]*justify-content: flex-start/)
  assert.match(css,/\.playing-card:first-child \{ margin-left: auto; \}/)
  assert.match(css,/\.playing-card:last-child \{ margin-right: auto; \}/)
  assert.match(css,/scroll-padding-inline: 14px/)
})
