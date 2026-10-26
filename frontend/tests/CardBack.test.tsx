import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CardBack } from '../src/CardBack'

const art = vi.hoisted(() => ({ create: vi.fn(), draw: vi.fn(), dispose: vi.fn(), paint: vi.fn() }))
vi.mock('../src/cardArt', () => ({
  createCardArtRenderer: () => { art.create(); return { draw: art.draw, dispose: art.dispose, isContextLost: () => false } },
  paintStillCardArt: art.paint,
}))
let callbacks: Map<number, FrameRequestCallback>
let resize: ResizeObserverCallback
let nextId: number
beforeEach(() => {
  vi.clearAllMocks()
  callbacks = new Map()
  nextId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextId, callback); return nextId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {} disconnect() {}
  })
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
})
afterEach(() => vi.unstubAllGlobals())
function frame(now: number) {
  const pending = [...callbacks.values()]
  callbacks.clear()
  act(() => pending.forEach(callback => callback(now)))
}

it('draws on every display frame and never reads canvas layout in the draw loop', () => {
  const { container, unmount } = render(<CardBack skin="AURORA" />)
  const canvas = container.querySelector('canvas')!
  const width = vi.fn(() => 108)
  const height = vi.fn(() => 152)
  Object.defineProperty(canvas, 'clientWidth', { get: width })
  Object.defineProperty(canvas, 'clientHeight', { get: height })
  act(() => resize([], {} as ResizeObserver))
  width.mockClear()
  height.mockClear()
  for (const now of [0, 16.67, 33.34, 50.01, 66.68, 83.35]) frame(now)
  expect(art.draw).toHaveBeenCalledTimes(6)
  expect(width).not.toHaveBeenCalled()
  expect(height).not.toHaveBeenCalled()
  unmount()
  expect(callbacks.size).toBe(0)
  expect(art.dispose).toHaveBeenCalledTimes(1)
})

it('uses cached artwork for flying cards without scheduling a renderer', () => {
  const { container } = render(<CardBack skin="SUPERNOVA" compact still />)
  expect(art.paint).toHaveBeenCalledWith(container.querySelector('canvas'), 'SUPERNOVA')
  expect(art.draw).not.toHaveBeenCalled()
  expect(callbacks.size).toBe(0)
})

it('keeps reduced-motion artwork static', () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
  render(<CardBack skin="PRISM" />)
  frame(16.67)
  frame(33.34)
  expect(art.draw).toHaveBeenCalledExactlyOnceWith('PRISM', 3)
  expect(callbacks.size).toBe(0)
})

it('changes editions without recompiling the shader or replacing its renderer', () => {
  const { rerender } = render(<CardBack skin="CLASSIC" />)
  frame(16.67)
  expect(callbacks.size).toBe(0)
  rerender(<CardBack skin="PRISM" />)
  frame(33.34)
  frame(50.01)
  expect(art.create).toHaveBeenCalledTimes(1)
  expect(art.dispose).not.toHaveBeenCalled()
  expect(art.draw).toHaveBeenLastCalledWith('PRISM', .05001)
})
