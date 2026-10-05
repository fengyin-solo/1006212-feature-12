#!/usr/bin/env node
/**
 * 校验已提交的初始化产物 == 用当前口径在内存里重算的结果。
 * 本地开发（predev）与部署构建（prebuild / Dockerfile）都跑同一套，
 * 保证「换环境后渗流量与扬压力的总数对得上」。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSeepage } from '../src/data/seepage/seepage-core.js'

const here = dirname(fileURLToPath(import.meta.url))
const seepageDir = resolve(here, '../src/data/seepage')
const policy = JSON.parse(readFileSync(resolve(seepageDir, 'policy.json'), 'utf8'))
const pointsDoc = JSON.parse(readFileSync(resolve(seepageDir, 'points.base.json'), 'utf8'))
const sampleDoc = JSON.parse(readFileSync(resolve(seepageDir, 'observations.sample.json'), 'utf8'))

const generated = JSON.parse(
  readFileSync(resolve(here, '../src/data/generated-seed.json'), 'utf8'),
)

const rebuilt = buildSeepage({ policy, pointsDoc, sampleDoc })
const checksum = createHash('sha256').update(JSON.stringify(rebuilt.entries)).digest('hex')

const failures = []
if (JSON.stringify(rebuilt.entries) !== JSON.stringify(generated.seepage.rows)) {
  failures.push('初始化记录与口径重算结果不一致（请先运行 npm run seed:build 并提交产物）')
}
if (checksum !== generated.seepage.checksum) failures.push('校验和不一致')
if (rebuilt.totals.渗流量 !== generated.seepage.totals.渗流量) failures.push('渗流量总数不一致')
if (rebuilt.totals.扬压力 !== generated.seepage.totals.扬压力) failures.push('扬压力总数不一致')

if (failures.length) {
  console.error('[seed:check] FAIL')
  for (const reason of failures) console.error(`  - ${reason}`)
  process.exit(1)
}

console.log(
  `[seed:check] OK version=${policy.version} rows=${rebuilt.entries.length} ` +
    `渗流量=${rebuilt.totals.渗流量} 扬压力=${rebuilt.totals.扬压力} checksum=${checksum.slice(0, 12)}`,
)
