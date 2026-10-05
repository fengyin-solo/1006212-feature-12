import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：渗流等模块换成按初始化口径重建的产物，键名带版本，旧版脏数据不会被带进来。
const STORAGE_KEY = 'hydropower-plant-om:entries:v2'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 初始化为幂等操作：只有键不存在或内容损坏时才整体写入一份完整种子；
// 反复调用不会与已有内容合并去叠加，故不会多出重复测点。
function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 以种子模块清单为准补齐缺失模块，但绝不重复合并已有模块。
    const merged = clone(fallback)
    for (const key of Object.keys(merged)) {
      if (Array.isArray(parsed[key])) {
        merged[key] = parsed[key]
      }
    }
    return merged
  } catch {
    // 内容损坏：回到同一套初始化口径，整体覆盖，不保留半截脏数据。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
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

// 单次写入：登记/导入校验通过后整表一次性落盘，不产生中间态。
export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
