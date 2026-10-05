// 渗流/电站/机组/导轴承初始数据生成器：基线数据（data/base）→ 初始化产物（data/generated）。
// 零依赖、不读时钟、不读环境变量：同一套基线反复生成得到逐字节一致的结果（可重复初始化）。
// dev（predev）与部署构建（Docker builder / npm run build）都走这一条流水线。
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  POLICY_VERSION,
  OBSERVATION_SLOTS,
  GAP_POLICY_LABEL,
  classifySeepageStatus,
  dedupeFirstWins,
  gapTierOf,
  sumMetric,
  warningText,
} from './seepage-policy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BASE_DIR = join(ROOT, 'data', 'base')
const OUT_DIR = join(ROOT, 'data', 'generated')

const readJson = (name) => JSON.parse(readFileSync(join(BASE_DIR, name), 'utf-8'))

const round2 = (value) => Math.round(value * 100) / 100

// 确定性伪随机：种子固定 → 每次重建数值完全一致。
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function datesBetween(start, end) {
  const dates = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const stop = new Date(`${end}T00:00:00Z`)
  while (cursor.getTime() <= stop.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function gapMapOf(gaps) {
  const map = new Map()
  for (const gap of gaps) {
    const set = map.get(gap.code) ?? new Set()
    for (let i = gap.start; i <= gap.end; i += 1) set.add(i)
    map.set(gap.code, set)
  }
  return map
}

// 在连续缺测段上按档补齐：半天插补、一天沿用、三天以上不补。
function fillGapSeries(series, runsByPoint) {
  for (const pointCode of Object.keys(runsByPoint)) {
    for (const run of runsByPoint[pointCode]) {
      const tier = gapTierOf(run.length)
      for (const field of ['level', 'flow', 'uplift']) {
        if (tier === 'halfDay') {
          const prev = run.start - 1 >= 0 ? series[pointCode][run.start - 1][field] : null
          const next = run.end + 1 < series[pointCode].length ? series[pointCode][run.end + 1][field] : null
          if (prev !== null && next !== null) {
            for (let k = 0; k < run.length; k += 1) {
              series[pointCode][run.start + k][field] = round2(
                prev + ((next - prev) * (k + 1)) / (run.length + 1),
              )
            }
          }
        } else if (tier === 'oneDay') {
          const prev = run.start - 1 >= 0 ? series[pointCode][run.start - 1][field] : null
          if (prev !== null) {
            for (let k = 0; k < run.length; k += 1) {
              series[pointCode][run.start + k][field] = prev
            }
          }
        }
        // overThreeDay：保持 null，不补值，按缺测处理。
      }
    }
  }
}

function buildSeepage(pointsDoc, gapsDoc, legacyDoc) {
  const dates = datesBetween(gapsDoc.window.start, gapsDoc.window.end)
  const gapMap = gapMapOf(gapsDoc.gaps)
  const slotCount = dates.length * OBSERVATION_SLOTS.length

  // 1) 生成各测点的「真实过程线」与缺测标记
  const series = {}
  const runIndex = {}
  for (const point of pointsDoc.points) {
    const rand = mulberry32(point.seed * 7919 + 13)
    const missing = gapMap.get(point.code) ?? new Set()
    series[point.code] = []
    runIndex[point.code] = []
    for (let i = 0; i < slotCount; i += 1) {
      const t = i / 2
      const seasonal = 12 * Math.sin((i / slotCount) * Math.PI) // 月中库水位偏高
      // SEEP-0004 月末库水位抬升脉冲（24 日至 28 日），用于产生预警/报警样本
      let pulseLevel = 0
      let pulseFlow = 0
      let pulseUplift = 0
      if (point.code === 'SEEP-0004' && i >= 46 && i <= 55) {
        const hump = [2.0, 3.5, 5.0, 4.6, 3.8, 2.6, 1.8, 1.2, 0.6, 0]
        pulseLevel = hump[i - 46]
        pulseFlow = hump[i - 46] * 0.12
        pulseUplift = hump[i - 46] * 13
      }
      const noiseLevel = (rand() - 0.5) * 0.18
      const noiseFlow = (rand() - 0.5) * 0.04
      const noiseUplift = (rand() - 0.5) * 3
      series[point.code].push({
        index: i,
        missing: missing.has(i),
        // 缺测槽位先置空（保留原始缺测），再由 fillGapSeries 按半天/一天/三天以上分档决定补不补
        level: missing.has(i) ? null : round2(point.baseLevel + point.drift * t + seasonal * 0.01 + pulseLevel + noiseLevel),
        flow: missing.has(i) ? null : round2(point.baseFlow + seasonal * 0.004 + pulseFlow + noiseFlow),
        uplift: missing.has(i) ? null : Math.round(point.baseUplift + seasonal * 0.9 + pulseUplift + noiseUplift),
      })
    }
    // 找连续缺测段
    let i = 0
    while (i < slotCount) {
      if (!series[point.code][i].missing) {
        i += 1
        continue
      }
      const start = i
      while (i < slotCount && series[point.code][i].missing) i += 1
      runIndex[point.code].push({ start, end: i - 1, length: i - start })
    }
  }

  // 2) 按半天/一天/三天以上分档补齐
  fillGapSeries(series, runIndex)

  // 3) 落成台账行
  const rows = []
  const gapBuckets = { halfDay: 0, oneDay: 0, overThreeDay: 0 }
  pointsDoc.points.forEach((point) => {
    for (let i = 0; i < slotCount; i += 1) {
      const date = dates[Math.floor(i / OBSERVATION_SLOTS.length)]
      const time = OBSERVATION_SLOTS[i % OBSERVATION_SLOTS.length]
      const sample = series[point.code][i]
      if (sample.missing) gapBuckets[gapTierOf(runLengthAt(runIndex[point.code], i))] += 1
      const isGap = sample.missing
      const tier = isGap ? gapTierOf(runLengthAt(runIndex[point.code], i)) : null
      const value = (v) => (v === null || v === undefined ? '' : v)
      const row = {
        测点编号: point.code,
        测点位置: point.name,
        测点断面: point.section,
        测压管水位: value(sample.level),
        渗流量: value(sample.flow),
        扬压力: value(sample.uplift),
        警戒数值: warningText(point.code),
        监测日期: date,
        监测时间: time,
        原始缺测: isGap ? '测压管水位、渗流量、扬压力' : '',
        缺测处理: isGap ? GAP_POLICY_LABEL[tier] : '',
        补测标记:
          tier === 'halfDay' ? '线性插补' : tier === 'oneDay' ? '上次实测沿用' : tier === 'overThreeDay' ? '不补' : '',
      }
      const status =
        isGap && tier === 'overThreeDay'
          ? '正常'
          : classifySeepageStatus(point.code, { level: sample.level, flow: sample.flow, uplift: sample.uplift })
      rows.push(toEntry(row, status, { pending: status !== '正常', abnormal: status === '报警' }))
    }
  })

  // 4) 早期无监测日期存量：按测点编号顺序回填到观测窗口之前（仅留痕的两条正式回填记录）
  for (const record of legacyDoc.records) {
    rows.push(
      toEntry(
        {
          测点编号: record['测点编号'],
          测点位置: record['测点位置'],
          测点断面: '',
          测压管水位: record['测压管水位'],
          渗流量: record['渗流量'],
          扬压力: record['扬压力'],
          警戒数值: warningText(record['测点编号']),
          监测日期: record['回填日期'],
          监测时间: record['回填时间'],
          原始缺测: record['原始缺测'],
          缺测处理: '早期无监测日期·按编号顺序回填窗口前',
          补测标记: '',
        },
        '正常',
        { pending: false, abnormal: false },
      ),
    )
  }

  // 5) 先到先去重（同测点同监测时间只认第一次），再按日期、时间、编号稳定排序并重排 id
  const { kept, dropped } = dedupeFirstWins(rows, 'seepage')
  kept.sort((a, b) =>
    `${a['监测日期']} ${a['监测时间']} ${a['测点编号']}`.localeCompare(
      `${b['监测日期']} ${b['监测时间']} ${b['测点编号']}`,
    ),
  )
  kept.forEach((row, index) => {
    row.id = index + 1
  })
  return { rows: kept, dropped, gapBuckets, pointCount: pointsDoc.points.length }
}

function runLengthAt(runs, index) {
  const run = runs.find((item) => index >= item.start && index <= item.end)
  return run ? run.length : 0
}

function toEntry(fields, status, flags) {
  return {
    id: 0,
    status,
    pending: flags.pending,
    abnormal: flags.abnormal,
    ...fields,
    测点状态: status,
  }
}

function buildStations(stationsDoc, unitsDoc) {
  const countByStation = new Map()
  for (const unit of unitsDoc.units) {
    countByStation.set(unit['所属电站'], (countByStation.get(unit['所属电站']) ?? 0) + 1)
  }
  return stationsDoc.stations.map((item, index) => ({
    id: index + 1,
    status: item['运行状态'],
    pending: item['运行状态'] !== '停机检修',
    abnormal: false,
    电站编号: item['电站编号'],
    电站名称: item['电站名称'],
    装机容量: item['装机容量'],
    机组台数: countByStation.get(item['电站编号']) ?? 0,
    设计水头: item['设计水头'],
    投运日期: item['投运日期'],
    所属流域: item['所属流域'],
    运行状态: item['运行状态'],
  }))
}

function buildUnits(unitsDoc) {
  return unitsDoc.units.map((item, index) => {
    const status = item['运行状态']
    return {
      id: index + 1,
      status,
      pending: status !== '停机备用' && status !== '故障停机',
      abnormal: status === '故障停机',
      机组编号: item['机组编号'],
      机组型号: item['机组型号'],
      所属电站: item['所属电站'],
      额定转速: item['额定转速'],
      有功出力: item['有功出力'],
      无功出力: item['无功出力'],
      累计运行小时: item['累计运行小时'],
      振动数值: item['振动数值'],
      运行状态: status,
    }
  })
}

function buildBearings(doc) {
  const rows = doc.bearings.map((item, index) => {
    const maxTemp = Math.max(item['上导温度'], item['下导温度'])
    let status = '正常'
    if (maxTemp >= doc.thresholds['上导温度报警'] || item['油位高度'] < doc.thresholds['油位下限']) {
      status = '待检修'
    } else if (maxTemp >= doc.thresholds['上导温度警戒']) {
      status = '温度偏高'
    }
    return {
      id: index + 1,
      status,
      pending: status === '温度偏高' || status === '待检修',
      abnormal: status === '待检修',
      轴承编号: item['轴承编号'],
      所属机组: item['所属机组'],
      轴承部位: item['部位'],
      上导温度: item['上导温度'],
      下导温度: item['下导温度'],
      油位高度: item['油位高度'],
      振动数值: item['振动数值'],
      检测日期: doc.lastCheckDate,
      轴承状态: status,
    }
  })
  return rows
}

const CSV_COLUMNS = [
  '测点编号',
  '测点位置',
  '测点断面',
  '测压管水位',
  '渗流量',
  '扬压力',
  '警戒数值',
  '监测日期',
  '监测时间',
  '原始缺测',
  '缺测处理',
  '补测标记',
  '测点状态',
]

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => row[column] ?? '').join(','))
  }
  return `﻿${lines.join('\n')}\n`
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function main() {
  const pointsDoc = readJson('seepage-points.json')
  const gapsDoc = readJson('seepage-gaps.json')
  const legacyDoc = readJson('legacy-seepage.json')
  const stationsDoc = readJson('stations.json')
  const unitsDoc = readJson('units.json')
  const bearingsDoc = readJson('bearings.json')

  const seepage = buildSeepage(pointsDoc, gapsDoc, legacyDoc)
  const station = buildStations(stationsDoc, unitsDoc)
  const unit = buildUnits(unitsDoc)
  const bearing = buildBearings(bearingsDoc)

  // 联动模块各自再走一遍先到先去重，保证反复初始化不产生重复测点/台账行。
  const dedupe = {
    seepage: { dropped: seepage.dropped.length },
    station: { dropped: dedupeFirstWins(station, 'station').dropped.length },
    unit: { dropped: dedupeFirstWins(unit, 'unit').dropped.length },
    bearing: { dropped: dedupeFirstWins(bearing, 'bearing').dropped.length },
  }

  const csv = toCsv(seepage.rows)
  const unitCountByStation = {}
  for (const row of station) {
    unitCountByStation[row['电站编号']] = row['机组台数']
  }

  const artifacts = {
    'seed-seepage.json': seepage.rows,
    'seed-station.json': station,
    'seed-unit.json': unit,
    'seed-bearing.json': bearing,
  }
  const checksums = {}
  mkdirSync(OUT_DIR, { recursive: true })
  for (const [filename, value] of Object.entries(artifacts)) {
    const text = stableStringify(value)
    checksums[filename] = sha256(text)
    writeFileSync(join(OUT_DIR, filename), text, 'utf-8')
  }
  writeFileSync(join(OUT_DIR, 'seepage-records.csv'), csv, 'utf-8')

  const flowTotal = sumMetric(seepage.rows, '渗流量')
  const upliftTotal = sumMetric(seepage.rows, '扬压力')
  const manifest = {
    policyVersion: POLICY_VERSION,
    generatedAt: 'deterministic',
    window: gapsDoc.window,
    slotsPerDay: OBSERVATION_SLOTS.length,
    pointCount: seepage.pointCount,
    seepageRecordCount: seepage.rows.length,
    seepageFlowTotal: flowTotal,
    seepageUpliftTotal: upliftTotal,
    gapBuckets: seepage.gapBuckets,
    statusCounts: {
      正常: seepage.rows.filter((r) => r.status === '正常').length,
      预警: seepage.rows.filter((r) => r.status === '预警').length,
      报警: seepage.rows.filter((r) => r.status === '报警').length,
    },
    stationCount: station.length,
    unitCount: unit.length,
    unitCountByStation,
    bearingCount: bearing.length,
    bearingPending: bearing.filter((r) => r.pending).length,
    dedupe,
    csvColumns: CSV_COLUMNS,
    checksums,
  }
  writeFileSync(join(OUT_DIR, 'manifest.json'), stableStringify(manifest), 'utf-8')

  process.stdout.write(
    [
      `policy=${POLICY_VERSION}`,
      `seepage: ${seepage.rows.length} 条（${seepage.pointCount} 测点 × ${gapsDoc.window.start}~${gapsDoc.window.end} 每日${OBSERVATION_SLOTS.length}测次 + 早期回填2条）`,
      `缺测分档: 半天=${seepage.gapBuckets.halfDay} 一天=${seepage.gapBuckets.oneDay} 三天以上=${seepage.gapBuckets.overThreeDay}`,
      `渗流量合计=${flowTotal} L/s 扬压力合计=${upliftTotal} kPa`,
      `电站${station.length} / 机组${unit.length}（台数分布 ${JSON.stringify(unitCountByStation)}）/ 导轴承${bearing.length}（待办${manifest.bearingPending}）`,
      `重复登记丢弃: ${JSON.stringify(dedupe)}`,
    ].join('\n') + '\n',
  )
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exit(1)
})
