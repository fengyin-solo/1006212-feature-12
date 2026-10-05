#!/usr/bin/env node
/**
 * 渗流（含导轴承）初始化数据生成器——可重复生成的唯一生成入口。
 *
 * 输入：src/data/seepage/policy.json（口径+阈值）
 *       src/data/seepage/points.base.json（基础点位数据）
 *       src/data/seepage/observations.sample.json（示例观测/缺测/重复/存量）
 * 产物：src/data/generated-seed.json（前端本地开发与部署构建共同读取的初始化结果）
 * 另存：<repo>/data/export/*.csv（基础数据、原始观测、处理后台账、拒收重复，供单独核对）
 *
 * 同一份核心（seepage-core.js）在浏览器与本脚本里各跑一次：
 *   npm run seed:check 用「内存重算结果 == 已提交产物」保证反复初始化口径一致。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSeepage, sumMetric } from '../src/data/seepage/seepage-core.js'

const here = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(here, '..')
const repoDir = resolve(frontendDir, '..')

const seepageDir = resolve(frontendDir, 'src/data/seepage')
const policy = JSON.parse(readFileSync(resolve(seepageDir, 'policy.json'), 'utf8'))
const pointsDoc = JSON.parse(readFileSync(resolve(seepageDir, 'points.base.json'), 'utf8'))
const sampleDoc = JSON.parse(readFileSync(resolve(seepageDir, 'observations.sample.json'), 'utf8'))

const result = buildSeepage({ policy, pointsDoc, sampleDoc })

// 导轴承：确定性存量，4 个轴承覆盖正常/温度偏高/待检修；牵动导轴承待办清单与另一入口台数。
const bearingRows = [
  {
    id: 1,
    status: '正常',
    pending: false,
    abnormal: false,
    轴承编号: 'BEAR-0001',
    所属机组: '1号机组',
    上导温度: '46.2',
    下导温度: '48.1',
    油位高度: '320',
    振动数值: '0.06',
    检测日期: '2026-01-12',
    轴承状态: '正常',
  },
  {
    id: 2,
    status: '正常',
    pending: false,
    abnormal: false,
    轴承编号: 'BEAR-0002',
    所属机组: '2号机组',
    上导温度: '47.0',
    下导温度: '49.4',
    油位高度: '318',
    振动数值: '0.07',
    检测日期: '2026-01-12',
    轴承状态: '正常',
  },
  {
    id: 3,
    status: '温度偏高',
    pending: true,
    abnormal: true,
    轴承编号: 'BEAR-0003',
    所属机组: '3号机组',
    上导温度: '58.6',
    下导温度: '61.3',
    油位高度: '315',
    振动数值: '0.12',
    检测日期: '2026-01-13',
    轴承状态: '温度偏高，已列入待办',
  },
  {
    id: 4,
    status: '待检修',
    pending: true,
    abnormal: true,
    轴承编号: 'BEAR-0004',
    所属机组: '4号机组',
    上导温度: '63.8',
    下导温度: '66.5',
    油位高度: '309',
    振动数值: '0.15',
    检测日期: '2026-01-13',
    轴承状态: '待检修，已列入待办',
  },
]

const checksumInput = JSON.stringify(result.entries)
const checksum = createHash('sha256').update(checksumInput).digest('hex')

const generated = {
  _comment:
    '由 frontend/scripts/build-seepage.mjs 按 src/data/seepage/policy.json 口径确定性生成，请勿手改；本地与部署环境读同一份。',
  version: policy.version,
  generatedAt: 'deterministic',
  seepage: {
    rows: result.entries,
    totals: result.totals,
    counts: result.counts,
    checksum,
  },
  bearing: {
    rows: bearingRows,
    totals: {
      轴承台数: bearingRows.length,
      待办台数: bearingRows.filter((row) => row.pending).length,
      异常台数: bearingRows.filter((row) => row.abnormal).length,
    },
  },
}

function writeAtomic(target, content) {
  const tmp = `${target}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(tmp, content)
  renameSync(tmp, target)
}

const seedTarget = resolve(frontendDir, 'src/data/generated-seed.json')
writeAtomic(seedTarget, `${JSON.stringify(generated, null, 2)}\n`)

// ---- 另存核对产物（基础数据 / 原始观测 / 处理后台账 / 拒收重复）----
const exportDir = resolve(repoDir, 'data/export')
rmSync(exportDir, { recursive: true, force: true })
mkdirSync(exportDir, { recursive: true })

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeCsv(name, columns, rows) {
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','))
  }
  writeAtomic(resolve(exportDir, name), `﻿${lines.join('\n')}\n`)
}

writeCsv(
  'seepage-points.base.csv',
  ['测点编号', '测点位置', '管底高程', '水位基准', '渗流量基准', '扬压力基准', '年变幅水位', '年变幅渗流量', '年变幅扬压力', '相位日'],
  pointsDoc.points,
)

writeCsv(
  'seepage-observations.raw.csv',
  ['测点编号', '测点位置', '监测日期', '监测时段', '测压管水位', '渗流量', '扬压力', '数据来源', '备注'],
  result.rawRows,
)

writeCsv(
  'seepage-records.processed.csv',
  ['id', '测点编号', '测点位置', '监测日期', '监测时段', '测压管水位', '渗流量', '扬压力', '警戒数值', '测点状态', '原始缺测', '缺测处理', '数据来源', 'status'],
  result.entries,
)

writeCsv(
  'seepage-duplicates.rejected.csv',
  ['测点编号', '监测日期', '监测时段', '拒收测压管水位', '拒收渗流量', '拒收扬压力', '拒收原因', '说明'],
  result.rejectedDuplicates,
)

const readme = `# 渗流初始化数据另存核对（generated artifact，勿手改）

本目录由 \`frontend/scripts/build-seepage.mjs\` 生成，供单独核对基础数据与示例数据。

- 口径版本：${policy.version}
- 数据窗口：${policy.window.start} ~ ${policy.window.end}，每日 ${policy.window.slotNames.join('/')} 两个时段（半天一档）
- 权威结论：\`seepage-records.processed.csv\` 为唯一进入页面台账的初始化结果；
  原始观测、拒收重复提交、三天以上缺测仅在此留痕。

## 文件

| 文件 | 内容 | 行数（不含表头） |
| --- | --- | --- |
| seepage-points.base.csv | 基础点位数据（点位台账参数） | ${pointsDoc.points.length} |
| seepage-observations.raw.csv | 示例原始观测快照（缺测留空，含被拒收的重复提交行） | ${result.rawRows.length} |
| seepage-records.processed.csv | 处理后渗流台账（另存的测点清单，记录数与页面一致） | ${result.entries.length} |
| seepage-duplicates.rejected.csv | 后到重复提交留痕（第一次取值生效） | ${result.rejectedDuplicates.length} |

## 缺测分档处理

- 半天（连续中断1个时段）：${policy.gapTiers.halfDay.note}
- 一天（连续中断2~5个时段，1天以上、3天以内）：${policy.gapTiers.oneDay.note}
- 三天以上（连续中断6个时段及以上）：${policy.gapTiers.longGap.note}

补齐记录保留「原始缺测=是」与「缺测处理」标记，不抹掉缺测痕迹。

## 预警判定阈值（本地与部署同一套）

- 测压管水位：≥ ${policy.thresholds.测压管水位.warn} ${policy.thresholds.测压管水位.unit} 预警，≥ ${policy.thresholds.测压管水位.alarm} ${policy.thresholds.测压管水位.unit} 报警
- 渗流量：≥ ${policy.thresholds.渗流量.warn} ${policy.thresholds.渗流量.unit} 预警，≥ ${policy.thresholds.渗流量.alarm} ${policy.thresholds.渗流量.unit} 报警
- 扬压力：≥ ${policy.thresholds.扬压力.warn} ${policy.thresholds.扬压力.unit} 预警，≥ ${policy.thresholds.扬压力.alarm} ${policy.thresholds.扬压力.unit} 报警

## 总量（换环境后应对得上）

- 渗流量合计（三天以上缺测不参与求和）：${result.totals.渗流量} L/s
- 扬压力合计：${result.totals.扬压力} kPa
- 有效读数条数：${result.totals.有效读数条数}
- 记录总数：${result.counts.slotsTotal}（实测 ${result.counts.measured}、半天内插 ${result.counts.interpolatedHalfDay}、一天内插 ${result.counts.interpolatedOneDay}、三天以上保留缺测 ${result.counts.keptMissing}、存量回填 ${result.counts.legacyBackfilled}）
- 正常 ${result.counts.status正常} / 预警 ${result.counts.status预警} / 报警 ${result.counts.status报警}
- 产物校验和：${checksum}

## 存量与早年缺项说明

- ${policy.legacyBackfill.order}
- ${policy.legacyBackfill.note}
- 导轴承存量台账按检测日期（记录时间）回填，共 ${bearingRows.length} 台，其中待办 ${generated.bearing.totals.待办台数} 台；
  早年纸质台账未记录检测日期的项目缺项另行登记，不在本次示例数据内补造。
`
writeAtomic(resolve(exportDir, 'README.md'), readme)

// ---- 自检：重算合计与 CSV 记录数必须对得上 ----
const recomputedFlow = sumMetric(result.entries, '渗流量')
const recomputedPressure = sumMetric(result.entries, '扬压力')
if (
  recomputedFlow !== result.totals.渗流量 ||
  recomputedPressure !== result.totals.扬压力
) {
  throw new Error('渗流量/扬压力合计自检失败')
}
if (result.entries.length !== result.counts.slotsTotal) {
  throw new Error('渗流记录数与时段总数不一致')
}

console.log(
  `[seed] seepage ${result.entries.length} rows | 渗流量 ${result.totals.渗流量} | 扬压力 ${result.totals.扬压力} | checksum ${checksum.slice(0, 12)}`,
)
console.log(
  `[seed] bearing ${bearingRows.length} rows (待办 ${generated.bearing.totals.待办台数}) | exports -> data/export`,
)
