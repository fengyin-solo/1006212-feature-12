// 渗流监测初始化口径：阈值、缺测分档、预警判定、去重主键全部集中在这一个文件。
// 本文件是零依赖 ESM，同时被两处引用：
//   1. scripts/build-seed.mjs / verify-seed.mjs（Node 侧生成与校验）
//   2. src 下的前端运行时（Vite 直接打包，dev 与部署读同一套判定）
// 这样阈值不会出现本地一套、部署一套。

// 口径版本号：阈值或缺测规则改动时递增，manifest 与校验都认它。
export const POLICY_VERSION = '2026.1-seepage-v1'

// 观测频次：一天两个测次（半天一测）。
export const OBSERVATION_SLOTS = ['08:00', '20:00']

// 缺测时段按连续中断天数分档处理：
//   halfDay : 连续中断半天（漏 1 个测次）→ 线性插补，保留缺测标记
//   oneDay  : 连续中断一天（全天 2 个测次都缺）→ 上次实测值沿用，保留缺测标记
//   overThreeDay : 连续中断三天及以上（≥6 个测次）→ 按缺测处理，不补值
// 落在一天、三天之间的两整天（3~5 个测次）按 oneDay 档沿用，并在口径说明中注明。
export function gapTierOf(missingSlots) {
  if (missingSlots <= 0) return null
  if (missingSlots === 1) return 'halfDay'
  if (missingSlots <= 5) return 'oneDay'
  return 'overThreeDay'
}

export const GAP_POLICY_LABEL = {
  halfDay: '半天缺测·线性插补',
  oneDay: '一天缺测·上次实测沿用',
  overThreeDay: '三天以上缺测·按缺测不补',
}

// 预警判定阈值（统一口径，构建期与页面运行时共用）。
// 扬压力单位 kPa，渗流量单位 L/s，测压管水位单位 m。
export const SEEPAGE_THRESHOLDS = [
  // 坝基渗压计：扬压力、渗流量为主控指标
  {
    code: 'SEEP-0001',
    name: '坝基渗压计P1',
    levelWarn: 244.0,
    levelAlarm: 246.5,
    flowWarn: 0.9,
    flowAlarm: 1.2,
    upliftWarn: 150,
    upliftAlarm: 180,
  },
  {
    code: 'SEEP-0002',
    name: '坝基渗压计P2',
    levelWarn: 243.5,
    levelAlarm: 246.0,
    flowWarn: 0.9,
    flowAlarm: 1.2,
    upliftWarn: 145,
    upliftAlarm: 175,
  },
  {
    code: 'SEEP-0003',
    name: '坝基渗压计P3',
    levelWarn: 243.0,
    levelAlarm: 245.5,
    flowWarn: 0.85,
    flowAlarm: 1.15,
    upliftWarn: 140,
    upliftAlarm: 170,
  },
  // 绕坝渗流：测压管水位为主控指标
  {
    code: 'SEEP-0004',
    name: '左岸绕坝渗流R1',
    levelWarn: 246.0,
    levelAlarm: 248.0,
    flowWarn: 1.3,
    flowAlarm: 1.55,
    upliftWarn: 160,
    upliftAlarm: 190,
  },
  {
    code: 'SEEP-0005',
    name: '右岸绕坝渗流R2',
    levelWarn: 245.5,
    levelAlarm: 247.5,
    flowWarn: 1.25,
    flowAlarm: 1.5,
    upliftWarn: 155,
    upliftAlarm: 185,
  },
  // 坝后量水堰：渗流量为主控指标
  {
    code: 'SEEP-0006',
    name: '坝后量水堰W1',
    levelWarn: 242.5,
    levelAlarm: 245.0,
    flowWarn: 2.1,
    flowAlarm: 2.6,
    upliftWarn: 130,
    upliftAlarm: 160,
  },
]

export const THRESHOLD_BY_CODE = new Map(SEEPAGE_THRESHOLDS.map((item) => [item.code, item]))

// 统一预警判定：任一指标达到报警 → 报警；任一达到警戒 → 预警；否则正常。
// 缺测（null）指标不参与判定。
export function classifySeepageStatus(code, values) {
  const t = THRESHOLD_BY_CODE.get(code)
  if (!t) return '正常'
  const checks = [
    { value: values.level, warn: t.levelWarn, alarm: t.levelAlarm },
    { value: values.flow, warn: t.flowWarn, alarm: t.flowAlarm },
    { value: values.uplift, warn: t.upliftWarn, alarm: t.upliftAlarm },
  ]
  let warned = false
  for (const check of checks) {
    if (check.value === null || check.value === undefined || check.value === '') continue
    if (Number(check.value) >= check.alarm) return '报警'
    if (Number(check.value) >= check.warn) warned = true
  }
  return warned ? '预警' : '正常'
}

// 警戒数值字段的统一文案。
export function warningText(code) {
  const t = THRESHOLD_BY_CODE.get(code)
  if (!t) return ''
  return `水位警戒${t.levelWarn}/报警${t.levelAlarm}；流量警戒${t.flowWarn}/报警${t.flowAlarm}；扬压力警戒${t.upliftWarn}/报警${t.upliftAlarm}`
}

// 登记去重的自然键：登记重复时只认第一次的取值，后到的按重复处理。
export const MODULE_NATURAL_KEYS = {
  // 渗流：同一测点同一监测日期+时间（测次）只认第一条
  seepage: (row) => `${row['测点编号']}|${row['监测日期']}|${row['监测时间']}`,
  station: (row) => `${row['电站编号']}`,
  unit: (row) => `${row['机组编号']}`,
  bearing: (row) => `${row['轴承编号']}`,
}

export function naturalKeyOf(moduleKey, row) {
  const getter = MODULE_NATURAL_KEYS[moduleKey]
  return getter ? getter(row) : `id:${row.id}`
}

// 生成期去重：先到先留，后到丢弃（只认第一次的取值）。
export function dedupeFirstWins(rows, moduleKey) {
  const seen = new Set()
  const kept = []
  const dropped = []
  for (const row of rows) {
    const key = naturalKeyOf(moduleKey, row)
    if (seen.has(key)) {
      dropped.push({ key, row })
    } else {
      seen.add(key)
      kept.push(row)
    }
  }
  return { kept, dropped }
}

// 渗流量与扬压力合计：缺测（空串/null）不计入，数值保留两位小数。
export function sumMetric(rows, field) {
  const total = rows.reduce((sum, row) => {
    const value = row[field]
    if (value === '' || value === null || value === undefined) return sum
    return sum + Number(value)
  }, 0)
  return Math.round(total * 100) / 100
}

// 极简 CSV 解析（与 local-service 的导出配套，导入明细与台账字段一致）。
export function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').trim().split(/\r?\n/)
  if (lines.length === 0) return { header: [], records: [] }
  const header = lines[0].split(',')
  const records = lines.slice(1).filter((line) => line.trim() !== '').map((line) => {
    const cells = line.split(',')
    const record = {}
    header.forEach((name, index) => {
      record[name] = cells[index] ?? ''
    })
    return record
  })
  return { header, records }
}
