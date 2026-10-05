/** seepage-core.js 的类型声明：核心为纯 JS，供 Node 生成脚本与前端 TypeScript 共用。 */
import type { EntryRow } from '../types'

export type SeepagePolicy = {
  version: string
  window: {
    start: string
    end: string
    slotsPerDay: number
    slotNames: string[]
  }
  dedupeKey: string[]
  gapTiers: Record<string, { minSlots?: number; maxSlots?: number; label: string; method: string; note: string }>
  thresholds: Record<string, { unit: string; warn: number; alarm: number }>
  legacyBackfill: { order: string; note: string }
  authority: { canonical: string; note: string }
}

export function round2(value: number): number
export function dayIndexOfYear(dateStr: string): number
export function enumerateSlots(window: SeepagePolicy['window']): {
  date: string
  slot: string
  slotIndex: number
  index: number
}[]
export function slotKey(id: string, date: string, slot: string): string
export function syntheticReading(
  point: Record<string, number>,
  date: string,
  slot: string,
  slotNames: string[],
): { 测压管水位: number; 渗流量: number; 扬压力: number }
export function evaluateStatus(
  values: Record<string, number | string>,
  thresholds: SeepagePolicy['thresholds'],
): { status: string; abnormal: boolean }
export function thresholdsText(thresholds: SeepagePolicy['thresholds']): string
export function sumMetric(rows: EntryRow[], field: string): number
export function dedupeByKey<T extends Record<string, unknown>>(rows: T[], keyFields: string[]): T[]
export function canonicalizeSeepageRows(
  rows: EntryRow[],
  policy: SeepagePolicy,
): EntryRow[]
export function buildSeepage(input: {
  policy: SeepagePolicy
  pointsDoc: { points: Record<string, unknown>[] }
  sampleDoc: {
    missingSpans?: unknown[]
    duplicateSubmissions?: unknown[]
    legacyRecords?: unknown[]
  }
}): {
  entries: EntryRow[]
  rawRows: Record<string, unknown>[]
  rejectedDuplicates: Record<string, unknown>[]
  counts: Record<string, number>
  totals: Record<string, number>
}
