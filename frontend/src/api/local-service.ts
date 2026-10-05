import { naturalKeyOf, parseCsv, sumMetric } from '../../scripts/seepage-policy.mjs'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { SEED_MANIFEST } from '@/data/seed'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export type RegisterResult = { ok: boolean; message: string; duplicated: boolean; id?: number }

// 登记：按模块自然键去重，只认第一次的取值，后到的按重复处理，重复提交只生效一次。
// 调用方在提交期间自行禁用按钮（不产生中间态）；这里即使被并发点到也是幂等的。
export function registerEntry(key: string, fields: Record<string, string | number | boolean>): RegisterResult {
  moduleMeta(key)
  const rows = listRows(key)
  const incoming = fields as unknown as EntryRow
  const candidateKey = naturalKeyOf(key, incoming)
  const existing = rows.find((row) => naturalKeyOf(key, row) === candidateKey)
  if (existing) {
    return {
      ok: false,
      duplicated: true,
      id: Number(existing.id),
      message: `同一自然键（${candidateKey}）已在 ${existing.id} 号登记过：只认第一次的取值，本次按重复处理`,
    }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const { status: statusInput, pending: pendingInput, abnormal: abnormalInput, ...businessFields } = fields
  const status = String(statusInput ?? '正常')
  // 一次校验、一次写入，落盘前不修改原表 —— 覆盖只发生在最终一版，不留中间态。
  const row: EntryRow = {
    id,
    status,
    pending: pendingInput === undefined ? status !== '已处理' : Boolean(pendingInput),
    abnormal: abnormalInput === undefined ? status === '报警' : Boolean(abnormalInput),
    ...businessFields,
  }
  saveRows(key, [...rows, row])
  return { ok: true, duplicated: false, id, message: `${moduleMeta(key).entity}登记成功，编号 ${id}` }
}

export type ImportResult = {
  ok: boolean
  message: string
  inserted: number
  duplicated: number
  duplicatedKeys: string[]
}

// CSV 导入：明细字段必须与台账口径一致；先全量校验、全量判重，再一次性整表写入。
// 任一行不合规则整批失败（原子提交，不留中间态）；重复明细按重复处理，只认第一次取值。
export function importEntries(key: string, csvText: string): ImportResult {
  const meta = moduleMeta(key)
  const { header, records } = parseCsv(csvText) as { header: string[]; records: Record<string, string>[] }
  const expectedHeader = ['编号', ...meta.fields, '当前状态']
  if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
    return {
      ok: false,
      inserted: 0,
      duplicated: 0,
      duplicatedKeys: [],
      message: `导入明细列与台账不一致：应为 ${expectedHeader.join('、')}`,
    }
  }
  if (records.length === 0) {
    return { ok: false, inserted: 0, duplicated: 0, duplicatedKeys: [], message: '导入明细为空，未做任何改动' }
  }
  const current = listRows(key)
  const next = [...current]
  const seen = new Set(current.map((row) => naturalKeyOf(key, row)))
  const duplicatedKeys: string[] = []
  let nextId = current.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  for (const record of records) {
    const candidate: Record<string, string | number | boolean> = {}
    for (const field of meta.fields) {
      candidate[field] = record[field] ?? ''
    }
    const candidateKey = naturalKeyOf(key, candidate as unknown as EntryRow)
    if (seen.has(candidateKey)) {
      duplicatedKeys.push(candidateKey)
      continue
    }
    seen.add(candidateKey)
    nextId += 1
    const status = record['当前状态'] || '正常'
    next.push({ id: nextId, status, pending: status !== '已处理', abnormal: status === '报警', ...candidate })
  }
  if (next.length === current.length) {
    return {
      ok: false,
      inserted: 0,
      duplicated: records.length,
      duplicatedKeys,
      message: `导入的 ${records.length} 条明细均为重复记录，台账未改动`,
    }
  }
  // 校验全过后单次整表落盘。
  saveRows(key, next)
  return {
    ok: true,
    inserted: next.length - current.length,
    duplicated: duplicatedKeys.length,
    duplicatedKeys,
    message: `导入完成：新增 ${next.length - current.length} 条，重复 ${duplicatedKeys.length} 条（按第一次取值保留），台账共 ${next.length} 条`,
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 渗流统计：合计口径与构建校验共用 sumMetric，缺测空值不计入，页面数与 manifest 对得上。
export function seepageStats(rows: EntryRow[]) {
  return {
    pointCount: SEED_MANIFEST.pointCount,
    recordCount: rows.length,
    flowTotal: sumMetric(rows, '渗流量') as number,
    upliftTotal: sumMetric(rows, '扬压力') as number,
    warnCount: rows.filter((row) => row.status === '预警' || row.status === '报警').length,
    gapCount: rows.filter((row) => String(row['原始缺测'] ?? '') !== '' && !String(row['缺测处理'] ?? '').startsWith('早期')).length,
  }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
