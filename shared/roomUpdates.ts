import type { RoomView } from './contracts.ts'

type Path = (string | number)[]
export type RoomOperation =
  | { path: Path; value: unknown }
  | { path: Path; remove: true }
  | { path: Path; splice: { start: number; count: number; items: unknown[] } }
export interface RoomUpdate {
  roomId: string
  baseRevision: number
  revision: number
  operations: RoomOperation[]
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!object(a) || !object(b) || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
}
function sameEntry(a: unknown, b: unknown) {
  return object(a) && object(b) && a.id !== undefined && b.id !== undefined
    ? a.id === b.id : equal(a, b)
}
function keyed(values: unknown[]): values is (Record<string, unknown> & { id: string | number })[] {
  return values.every(value => object(value) && (typeof value.id === 'string' || typeof value.id === 'number'))
    && new Set(values.map(value => (value as { id: string | number }).id)).size === values.length
}

/** Diff only already-projected views: private server state never enters a patch. */
export function roomOperations(previous: RoomView, next: RoomView): RoomOperation[] {
  const operations: RoomOperation[] = []
  function diff(before: unknown, after: unknown, path: Path) {
    if (Object.is(before, after)) return
    if (Array.isArray(before) && Array.isArray(after)) {
      if (equal(before, after)) return
      const common = Math.min(before.length, after.length)
      if (keyed(before) && keyed(after)) {
        const old = new Map(before.map(value => [value.id, value]))
        const next = new Set(after.map(value => value.id))
        const retained = before.filter(value => next.has(value.id))
        const ordered = after.filter(value => old.has(value.id))
        if (retained.every((value, index) => value.id === ordered[index]?.id)) {
          // Drop old history entries and removed hand cards without resending
          // the surviving entries when their array indices shift.
          for (let end = before.length; end > 0;) {
            if (next.has(before[end - 1].id)) { end--; continue }
            let start = end - 1
            while (start > 0 && !next.has(before[start - 1].id)) start--
            operations.push({ path, splice: { start, count: end - start, items: [] } })
            end = start
          }
          for (let start = 0; start < after.length;) {
            if (old.has(after[start].id)) {
              diff(old.get(after[start].id), after[start], [...path, start])
              start++
            } else {
              let end = start + 1
              while (end < after.length && !old.has(after[end].id)) end++
              operations.push({ path, splice: { start, count: 0, items: after.slice(start, end) } })
              start = end
            }
          }
          return
        }
      }
      // Histories usually append an entry and change the preceding verdict.
      if (before.length === after.length || before.slice(0, common).every((item, index) => sameEntry(item, after[index]))) {
        for (let index = 0; index < common; index++) diff(before[index], after[index], [...path, index])
        if (before.length !== after.length) operations.push({ path, splice: { start: common, count: before.length - common, items: after.slice(common) } })
      } else {
        // A large play removes cards in one splice rather than retransmitting
        // the unchanged prefix/suffix or hundreds of shifted array indices.
        let start = 0, end = 0
        while (start < common && equal(before[start], after[start])) start++
        while (end < common - start && equal(before[before.length - 1 - end], after[after.length - 1 - end])) end++
        operations.push({ path, splice: { start, count: before.length - start - end, items: after.slice(start, after.length - end) } })
      }
    } else if (object(before) && object(after) && !Array.isArray(before) && !Array.isArray(after)) {
      for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) operations.push({ path: [...path, key], remove: true })
      for (const key of Object.keys(after)) {
        if (!Object.hasOwn(before, key)) operations.push({ path: [...path, key], value: after[key] })
        else diff(before[key], after[key], [...path, key])
      }
    } else operations.push({ path, value: after })
  }
  diff(previous, next, [])
  return operations
}

/** Copy changed branches only, preserving stable hands and cards in the client. */
export function applyRoomOperations(room: RoomView, operations: RoomOperation[]): RoomView {
  let result: unknown = room
  for (const operation of operations) {
    function update(value: unknown, depth: number): unknown {
      if (depth === operation.path.length) {
        if ('splice' in operation) {
          if (!Array.isArray(value)) throw new Error('Invalid room array update')
          const { start, count, items } = operation.splice
          if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > value.length) throw new Error('Invalid room splice')
          return [...value.slice(0, start), ...items, ...value.slice(start + count)]
        }
        return 'value' in operation ? operation.value : undefined
      }
      const key = operation.path[depth]
      if (!object(value) || ['__proto__', 'constructor', 'prototype'].includes(String(key))) throw new Error('Invalid room path')
      const copy: Record<string, unknown> = Array.isArray(value) ? [...value] as unknown as Record<string, unknown> : { ...value }
      if ('remove' in operation && depth === operation.path.length - 1) delete copy[key]
      else copy[key] = update(value[key], depth + 1)
      return copy
    }
    result = update(result, 0)
  }
  return result as RoomView
}
