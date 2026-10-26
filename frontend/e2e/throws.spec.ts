import { expect, test, type Page } from '@playwright/test'
import { LiarsDeckEngine } from '../../server/src/game/classic'
import { gameCashflow } from '../../server/src/game/throwables'
import { room, self, other } from '../tests/fixtures'
import type { GameType, RoomView, ThrowItemId } from '../src/types'
import type { GameCommand } from '../../server/src/game/state'

async function install(page: Page, view: RoomView, player = self) {
  await page.goto('/')
  await page.evaluate(async ({ view, player }) => {
    const path='/src/store.ts'
    const { useGameStore }=await import(path)
    useGameStore.setState({ room:view,player,bootstrapping:false,connected:true,
      throwItem:(item:ThrowItemId,targetId:string)=>{ void (window as unknown as { submitThrow:(item:ThrowItemId,target:string)=>Promise<void> }).submitThrow(item,targetId);return true },
    })
  }, { view,player })
  await expect(page.locator('.throw-effects canvas')).toHaveAttribute('data-renderer',/webgl|fallback/)
}
async function update(page:Page, view:RoomView, error:string|null=null) {
  await page.evaluate(async ({ view,error })=>{
    const path='/src/store.ts'
    const { useGameStore }=await import(path)
    useGameStore.setState({room:view,error})
  },{view,error})
}

for (const { earned, delayedReceipt } of [{ earned: 200, delayedReceipt: false }, ...[200, 50, 0].map(earned => ({ earned, delayedReceipt: true }))]) {
  test(`continuous tomato purchases cost 100 each with ${earned} earned coins and ${delayedReceipt ? 'delayed' : 'immediate'} confirmation`, async ({ page }) => {
    const rules = new LiarsDeckEngine()
    const model = rules.start('room-one', [self.id, other.id], { deckCount: 1, cardsPerPlayer: 3 })
    model.earnings[self.id] = earned
    let balance = 1000 + earned
    const receipts = new Set<string>()
    const acknowledgements: (() => void)[] = []
    const snapshot = () => {
      const view = room({ game: rules.view(model, self.id) })
      view.players[0].balance = balance
      return view
    }
    await page.route('**/api/**', route => route.fulfill({
      json: new URL(route.request().url()).pathname.startsWith('/api/players') ? self : [],
      headers: { 'Access-Control-Allow-Origin': '*' },
    }))
    await page.routeWebSocket('**/ws', socket => {
      const send = (type: string, payload: unknown) => socket.send(JSON.stringify({ type, payload }))
      socket.onMessage(raw => {
        const message = JSON.parse(String(raw))
        if (message.type === 'AUTH') send('CONNECTED', { playerId: self.id })
        if (message.type === 'SYNC_ROOM') send('ROOM_STATE', snapshot())
        if (message.type === 'GAME_COMMAND' && message.payload.action === 'THROW') {
          const command = message.payload as GameCommand
          if (!receipts.has(command.requestId!)) {
            const before = gameCashflow(model)
            rules.command(model, self.id, command, Date.now(), balance)
            balance += gameCashflow(model)[self.id] - before[self.id]
            receipts.add(command.requestId!)
          }
          send('ROOM_STATE', snapshot())
          const acknowledge = () => send('THROW_CONFIRMED', { requestId: command.requestId })
          if (delayedReceipt) acknowledgements.push(acknowledge)
          else acknowledge()
        }
      })
    })
    await page.goto('/')
    await page.getByLabel('PLAYER NAME', { exact: true }).fill(self.displayName)
    await page.getByRole('button', { name: 'Take a seat' }).click()
    await expect(page.getByRole('button', { name: 'Create table' })).toBeVisible()
    await page.evaluate(async view => {
      const path = '/src/store.ts'
      const { useGameStore } = await import(path)
      useGameStore.setState({ room: view })
    }, snapshot())
    const dock = page.getByRole('complementary', { name: 'Throwing items' })
    await dock.getByRole('button', { name: /Expand throwing bar/ }).click()
    await page.getByRole('combobox', { name: 'Throw at' }).selectOption(other.id)
    const tomato = page.getByRole('button', { name: 'Buy and throw Tomato for 100 coins' })
    const expectBalance = async (expected: number) => {
      await expect(dock.locator('.throw-dock-balance')).toHaveText(`${expected.toLocaleString()} ◆`)
      expect(balance).toBe(expected)
    }
    await expectBalance(1000 + earned)
    await tomato.click()
    await expectBalance(900 + earned)
    expect(model.throws).toHaveLength(1)
    expect(model.throws![0].fromEarnings).toBe(Math.min(100, earned))
    expect(model.throws![0].fromWallet).toBe(100 - Math.min(100, earned))
    await tomato.dblclick()
    await expectBalance(700 + earned)
    expect(model.throws).toHaveLength(3)
    // Every intentional click is accepted even while earlier receipts are delayed.
    const accepted = await page.evaluate(async targetId => {
      const path = '/src/store.ts'
      const { useGameStore } = await import(path)
      return Array.from({ length: 5 }, () => useGameStore.getState().throwItem('TOMATO', targetId))
    }, other.id)
    expect(accepted).toEqual([true, true, true, true, true])
    await expectBalance(200 + earned)
    expect(model.throws).toHaveLength(8)
    expect(model.throwSpending![self.id].amount).toBe(800)
    expect(receipts.size).toBe(8)
    for (const acknowledge of acknowledgements) acknowledge()
    await expect(tomato).toBeEnabled()
    await page.screenshot({ path: test.info().outputPath('continuous-tomato-charges.png') })
  })
}

for(const type of ['LIARS_DECK','LIARS_DECK_PLUS','LIARS_DECK_4_FUN','LIARS_DECK_4FUN_PLUS'] as GameType[]) {
  test(`targeted throws, currency split, shader impacts and folding work in ${type}`,async({page,context})=>{
    await page.emulateMedia({reducedMotion:'no-preference'})
    const guest=await context.newPage()
    await guest.emulateMedia({reducedMotion:'no-preference'})
    const errors:string[]=[]
    for(const viewer of [page,guest]) viewer.on('pageerror',error=>errors.push(error.message))
    // Throw commands are inherited unchanged in every mode (covered by the server suite).
    const rules=new LiarsDeckEngine()
    const model=rules.start('room-one',[self.id,other.id,'three'],{deckCount:1,cardsPerPlayer:3})
    model.earnings[self.id]=220
    model.currentIndex=model.order.indexOf(other.id)
    const members=room().players
    members[0].balance=720
    members.push({...members[1],id:'three',displayName:'Pilot',identityTag:'33333',seatIndex:2})
    const snapshot=(id:string)=>room({gameType:type,players:structuredClone(members),game:rules.view(model,id)})
    const broadcast=async()=>Promise.all([update(page,snapshot(self.id)),update(guest,snapshot(other.id))])
    await page.exposeFunction('submitThrow',async(item:ThrowItemId,targetId:string)=>{
      try{
        const before=gameCashflow(model)
        rules.command(model,self.id,{roomId:'room-one',action:'THROW',item,targetId,gameId:model.gameId},Date.now(),members[0].balance)
        const after=gameCashflow(model)
        members[0].balance+=after[self.id]-before[self.id]
        await broadcast()
      }catch(error){await update(page,snapshot(self.id),error instanceof Error?error.message:'Purchase failed')}
    })
    await install(page,snapshot(self.id))
    await install(guest,snapshot(other.id),other)
    const dock=page.getByRole('complementary',{name:'Throwing items'})
    await expect(dock).toBeVisible()
    await expect(dock.locator('.throw-dock-balance')).toHaveText('720 ◆')
    await expect(page.locator('.game-wallet strong')).toContainText('+220')
    await expect(page.locator('.room-wallet strong')).toHaveText('500 ◆')
    expect((await dock.boundingBox())!.height).toBeLessThan(65)
    await dock.getByRole('button',{name:/Expand throwing bar/}).click()
    const target=page.getByRole('combobox',{name:'Throw at'})
    await expect(page.getByRole('button',{name:'Buy and throw Coffee for 300 coins'})).toBeDisabled()
    await target.selectOption('three')
    await page.getByRole('button',{name:'Buy and throw Coffee for 300 coins'}).click()
    await expect.poll(()=>members[0].balance).toBe(420)
    await expect(dock.locator('.throw-dock-balance')).toHaveText('420 ◆')
    expect(model.throws![0].fromEarnings).toBe(220)
    expect(model.throws![0].fromWallet).toBe(80)
    for(const viewer of [page,guest]) await expect(viewer.locator('[data-throw-item="COFFEE"][data-throw-target="three"]')).toHaveCount(1)
    await expect(page.locator('.throw-effects canvas')).toHaveAttribute('data-renderer','webgl')
    await expect(page.locator('.throw-effects canvas')).toHaveAttribute('data-phase','impact')
    await page.screenshot({path:test.info().outputPath(`${type}-coffee-impact.png`)})
    await expect(page.getByRole('button',{name:'Buy and throw Airplane for 500 coins'})).toBeDisabled()
    await target.selectOption(other.id)
    await page.getByRole('button',{name:'Buy and throw Tomato for 100 coins'}).click()
    await expect.poll(()=>members[0].balance).toBe(320)
    for(const viewer of [page,guest]) await expect(viewer.locator('[data-throw-item="TOMATO"][data-throw-target="two"]')).toHaveCount(1)
    await expect(page.locator('.throw-effects canvas')).toHaveAttribute('data-phase','impact')
    await page.screenshot({path:test.info().outputPath(`${type}-tomato-impact.png`)})
    model.earnings[self.id]+=500;members[0].balance+=500
    await broadcast()
    await expect(dock.locator('.throw-dock-balance')).toHaveText('820 ◆')
    await page.getByRole('button',{name:'Buy and throw Airplane for 500 coins'}).click()
    await expect.poll(()=>model.throws!.length).toBe(3)
    expect(model.throws![2].fromEarnings).toBe(500)
    expect(members[0].balance).toBe(320)
    await expect(guest.locator('[data-throw-item="AIRPLANE"]')).toHaveCount(1)
    await expect(page.locator('.throw-effects canvas')).toHaveAttribute('data-phase','impact')
    await page.screenshot({path:test.info().outputPath(`${type}-airplane-impact.png`)})
    const bounds=(await dock.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await dock.getByRole('button',{name:/Collapse throwing bar/}).click()
    await expect(target).toBeHidden()
    await page.reload()
    await install(page,snapshot(self.id))
    await expect(page.locator('[data-throw-item]')).toHaveCount(0)
    await update(page,{...snapshot(self.id),game:null,status:'LOBBY'})
    await expect(dock).toHaveCount(0)
    expect(errors).toEqual([])
    await guest.close()
  })
}

test('pending coins cannot buy items and disconnected clients cannot throw',async({page})=>{
  const view=room()
  view.players[0].balance=99
  view.game!.earnings=[{playerId:self.id,amount:50}]
  view.game!.pendingClaim={playerId:self.id,cardCount:50,generation:10,risk:5000}
  await install(page,view)
  await page.getByRole('button',{name:/Expand throwing bar/}).click()
  await page.getByRole('combobox',{name:'Throw at'}).selectOption(other.id)
  await expect(page.getByRole('button',{name:'Buy and throw Tomato for 100 coins'})).toBeDisabled()
  view.players[0].balance=1000
  await update(page,view)
  await page.evaluate(async()=>{const path='/src/store.ts';const {useGameStore}=await import(path);useGameStore.setState({connected:false})})
  await expect(page.getByRole('button',{name:'Buy and throw Tomato for 100 coins'})).toBeDisabled()
})

test('effects fall back cleanly when WebGL is unavailable',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype,'getContext',{value:function(this:HTMLCanvasElement,kind:string,...args:unknown[]){
      if(kind==='webgl'||kind==='webgl2')return null
      return Reflect.apply(original,this,[kind,...args])
    }})
  })
  const view=room()
  await install(page,view)
  view.game!.throws=[{id:1,item:'TOMATO',playerId:other.id,targetId:self.id,cost:100,fromEarnings:0,fromWallet:100}]
  await update(page,view)
  await expect(page.locator('[data-throw-item="TOMATO"]')).toHaveCount(1)
  const canvas=page.locator('.throw-effects canvas')
  await expect(canvas).toHaveAttribute('data-renderer','fallback')
  await expect(canvas).toHaveAttribute('data-phase','impact')
  expect(await canvas.evaluate(element=>{
    const canvas=element as HTMLCanvasElement
    return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0)
  })).toBe(true)
})
