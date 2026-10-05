// 初始化产物校验：生成器跑完后立刻用同一套口径核对，dev 与部署构建都会执行。
// 任何一条不过就退出非零，构建失败 —— 保证本地与部署读到的是同一份、且总数对得上。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MODULE_NATURAL_KEYS,
  POLICY_VERSION,
  classifySeepageStatus,
  gapTierOf,
  sumMetric,
} from './seepage-policy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GENERATED = join(HERE, '..', 'data', 'generated')
const ARCHIVE = join(HERE, '..', 'data', 'archive')

const read = (dir, name) => readFileSync(join(dir, name), 'utf-8')
const readJson = (dir, name) => JSON.parse(read(dir, name))
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

const failures = []
function assert(condition, message) {
  if (!condition) failures.push(message)
}

const manifest = readJson(GENERATED, 'manifest.json')
const seepage = readJson(GENERATED, 'seed-seepage.json')
const stations = readJson(GENERATED, 'seed-station.json')
const units = readJson(GENERATED, 'seed-unit.json')
const bearings = readJson(GENERATED, 'seed-bearing.json')
const csv = read(GENERATED, 'seepage-records.csv').replace(/^﻿/, '')

// 1) 口径版本：阈值口径必须是当前版本，防止本地一套、部署一套。
assert(manifest.policyVersion === POLICY_VERSION, `口径版本不一致：manifest=${manifest.policyVersion} 当前=${POLICY_VERSION}`)

// 2) 渗流总数与合计：换环境后渗流量、扬压力总数对得上。
assert(seepage.length === manifest.seepageRecordCount, `渗流行数 ${seepage.length} ≠ manifest ${manifest.seepageRecordCount}`)
assert(sumMetric(seepage, '渗流量') === manifest.seepageFlowTotal, '渗流量合计与 manifest 不符')
assert(sumMetric(seepage, '扬压力') === manifest.seepageUpliftTotal, '扬压力合计与 manifest 不符')
assert(manifest.pointCount === 6, `测点数应为 6，实际 ${manifest.pointCount}`)
assert(seepage.length === 374, `渗流记录应为 374（6×31×2+2），实际 ${seepage.length}`)

// 3) 自然键唯一：反复初始化不会多出重复测点/台账行。
for (const [moduleKey, rows] of Object.entries({ seepage, station: stations, unit: units, bearing: bearings })) {
  const getter = MODULE_NATURAL_KEYS[moduleKey]
  const seen = new Set()
  for (const row of rows) {
    const key = getter(row)
    assert(!seen.has(key), `${moduleKey} 出现重复自然键：${key}`)
    seen.add(key)
  }
}

// 4) id 连续唯一。
for (const [moduleKey, rows] of Object.entries({ seepage, station: stations, unit: units, bearing: bearings })) {
  rows.forEach((row, index) => {
    assert(row.id === index + 1, `${moduleKey} 第 ${index + 1} 行 id=${row.id} 不连续`)
  })
}

// 5) 状态必须由统一阈值口径判定，不能本地一套部署一套。
for (const row of seepage) {
  if (row['补测标记'] === '不补') continue // 缺测不补的空值槽位不参与判定
  const expected = classifySeepageStatus(row['测点编号'], {
    level: row['测压管水位'] === '' ? null : row['测压管水位'],
    flow: row['渗流量'] === '' ? null : row['渗流量'],
    uplift: row['扬压力'] === '' ? null : row['扬压力'],
  })
  assert(row.status === expected, `${row['测点编号']} ${row['监测日期']} ${row['监测时间']} 状态 ${row.status} 与阈值口径 ${expected} 不符`)
  assert(row['测点状态'] === row.status, `${row['测点编号']} 测点状态字段与 status 不一致`)
}

// 6) 缺测分档：标记与连续中断天数必须一致，原始缺测标记保留。
const gapRows = seepage.filter((r) => r['原始缺测'] !== '')
const tierCount = { halfDay: 0, oneDay: 0, overThreeDay: 0 }
const byPointDate = new Map(seepage.map((r) => [`${r['测点编号']}|${r['监测日期']}|${r['监测时间']}`, r]))
for (const row of gapRows) {
  const tag = row['补测标记']
  if (row['缺测处理'].startsWith('早期')) continue
  const values = [row['测压管水位'], row['渗流量'], row['扬压力']]
  if (tag === '不补') {
    tierCount.overThreeDay += 1
    assert(values.every((v) => v === ''), `${row['测点编号']} ${row['监测日期']} 三天以上档却补了值`)
  } else if (tag === '线性插补') {
    tierCount.halfDay += 1
    assert(values.every((v) => v !== ''), `${row['测点编号']} ${row['监测日期']} 半天档未插补`)
  } else if (tag === '上次实测沿用') {
    tierCount.oneDay += 1
    assert(values.every((v) => v !== ''), `${row['测点编号']} ${row['监测日期']} 一天档未沿用`)
  } else {
    assert(false, `${row['测点编号']} ${row['监测日期']} 出现未知补测标记 ${tag}`)
  }
}
assert(JSON.stringify(tierCount) === JSON.stringify(manifest.gapBuckets), '缺测分档计数与 manifest 不符：' + JSON.stringify(tierCount))
// 档别与连续中断天数对得上：1→半天，2~5→一天，≥6→三天以上
assert(gapTierOf(1) === 'halfDay' && gapTierOf(4) === 'oneDay' && gapTierOf(6) === 'overThreeDay', '缺测分档阈值口径错误')

// 7) 另存测点清单行数与页面记录数一致（CSV 明细行数 == 台账行数）。
const csvDataLines = csv.trim().split(/\r?\n/).slice(1)
assert(csvDataLines.length === seepage.length, `另存清单 ${csvDataLines.length} 行 ≠ 台账 ${seepage.length} 条`)
assert(JSON.stringify(csv.trim().split(/\r?\n/)[0].split(',')) === JSON.stringify(manifest.csvColumns), '清单表头与口径列不一致')
for (const line of csvDataLines) {
  const code = line.split(',')[0]
  assert(seepage.some((r) => r['测点编号'] === code), `清单出现台账中没有的测点 ${code}`)
}

// 8) 电站机组台数跟着机组清单变：台数之和 == 机组记录总数；导轴承待办 == pending 计数。
const counted = new Map()
for (const unit of units) counted.set(unit['所属电站'], (counted.get(unit['所属电站']) ?? 0) + 1)
let stationUnitSum = 0
for (const station of stations) {
  stationUnitSum += station['机组台数']
  assert(station['机组台数'] === (counted.get(station['电站编号']) ?? 0), `${station['电站编号']} 机组台数与机组清单不一致`)
}
assert(stationUnitSum === units.length, `机组台数合计 ${stationUnitSum} ≠ 机组记录数 ${units.length}`)
assert(bearings.length === manifest.bearingCount, '导轴承总数与 manifest 不符')
assert(bearings.filter((b) => b.pending).length === manifest.bearingPending, '导轴承待办数与 manifest 不符')

// 9) 产物校验和：dev/部署读到同一份文件；旧脏数据只留痕、不参与初始化。
for (const [name, hash] of Object.entries(manifest.checksums)) {
  assert(sha256(read(GENERATED, name)) === hash, `${name} 校验和与 manifest 不符`)
}
const snapshot = readJson(ARCHIVE, 'legacy-seed-snapshot.seepage.json')
assert(snapshot.authoritative === false, '旧脏数据快照必须标记为非权威（仅留痕）')
assert(!seepage.some((r) => String(r['测点位置']).includes('样例')), '权威渗流数据里仍残留占位脏数据')

// 10) 预警/报警样本确实存在且来自阈值口径。
assert(manifest.statusCounts['报警'] >= 1, '缺少报警样本，阈值口径无法演示')
assert(manifest.statusCounts['预警'] >= 1, '缺少预警样本')

if (failures.length > 0) {
  process.stderr.write(`初始化产物校验失败（${failures.length} 条）：\n`)
  for (const message of failures) process.stderr.write(`  - ${message}\n`)
  process.exit(1)
}
process.stdout.write(
  `校验通过：${seepage.length} 条渗流记录 / 渗流量合计 ${manifest.seepageFlowTotal} L/s / 扬压力合计 ${manifest.seepageUpliftTotal} kPa / ` +
    `电站${stations.length} 机组${units.length} 导轴承${bearings.length}（待办${manifest.bearingPending}）/ 口径 ${POLICY_VERSION}\n`,
)
