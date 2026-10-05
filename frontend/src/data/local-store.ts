import generatedSeed from './generated-seed.json'
import policy from './seepage/policy.json'
import { canonicalizeSeepageRows } from './seepage/seepage-core'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 带口径版本号：初始化口径一变，旧版本地数据（含早期随手填的脏数据）整版作废，
// 重新按当前口径播种，避免「数据层一重装就回到脏数据」。
const STORAGE_KEY = 'hydropower-plant-om:entries'
const VERSION_KEY = 'hydropower-plant-om:seed-version'
const SEED_VERSION = generatedSeed.version

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 渗流按同一套口径做幂等规范化：重复登记键只认第一次取值，后到的按重复处理丢弃。
function normalizeSeepage(rows: EntryRow[]): EntryRow[] {
  return canonicalizeSeepageRows(rows, policy as never).map((row, index) => ({
    ...row,
    id: index + 1,
  }))
}

function freshSeed(): Record<string, EntryRow[]> {
  const seed = clone(SEED_ROWS)
  seed.seepage = normalizeSeepage(seed.seepage ?? [])
  return seed
}

// 一次性整体写入：先在内存拼好再落 localStorage，不留中间态。
function commit(next: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const normalized: Record<string, EntryRow[]> = {
    ...next,
    seepage: normalizeSeepage(next.seepage ?? []),
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    window.localStorage.setItem(VERSION_KEY, SEED_VERSION)
  }
  return normalized
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = freshSeed()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const version = window.localStorage.getItem(VERSION_KEY)
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw || version !== SEED_VERSION) {
    // 首次打开 / 口径升级 / 早期脏数据：整体替换成当前口径的初始化结果
    return commit(fallback)
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 以当前种子为基底，缺失模块用种子补齐；渗流每次读取再做一次幂等去重
    const merged = { ...fallback, ...parsed }
    return commit(merged)
  } catch {
    return commit(fallback)
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = commit(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, key === 'seepage' ? normalizeSeepage(rows) : rows)
  return listRows(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function seedVersion(): string {
  return SEED_VERSION
}
