/**
 * 渗流初始化口径的唯一实现（纯逻辑、无 DOM、无文件 IO）。
 *
 * 同一份模块被两侧引用，保证「一套口径」：
 *  - 流水线：scripts/build-seepage.mjs 用它从基础数据 + 示例观测生成初始化产物；
 *  - 浏览器：local-store / 渗流页面用它做去重与总数自检。
 *
 * 口径要点见 policy.json：
 *  - 半天（连续中断1个时段）：线性内插；
 *  - 一天（连续中断2~5个时段，1天以上、3天以内）：线性内插；
 *  - 三天以上（连续中断6个时段及以上）：不补值，保留原始缺测标记。
 *  - 重复登记键 = 测点编号 + 监测日期 + 监测时段，第一次取值生效，后到按重复处理。
 */

/** @param {number} value */
export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** @param {string} dateStr 形如 2026-01-31 */
export function dayIndexOfYear(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const start = Date.UTC(year, 0, 1)
  const current = Date.UTC(year, month - 1, day)
  return Math.round((current - start) / 86400000)
}

/**
 * 枚举窗口内全部半天时段。
 * @param {{start:string,end:string,slotNames:string[]}} window
 * @returns {{date:string,slot:string,slotIndex:number,index:number}[]}
 */
export function enumerateSlots(window) {
  const [sy, sm, sd] = window.start.split('-').map(Number)
  const [ey, em, ed] = window.end.split('-').map(Number)
  const slots = []
  const cursor = new Date(Date.UTC(sy, sm - 1, sd))
  const end = Date.UTC(ey, em - 1, ed)
  let index = 0
  while (cursor.getTime() <= end) {
    const y = cursor.getUTCFullYear()
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cursor.getUTCDate()).padStart(2, '0')
    const date = `${y}-${m}-${d}`
    window.slotNames.forEach((slot, slotIndex) => {
      slots.push({ date, slot, slotIndex, index })
      index += 1
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return slots
}

/** 重复登记键。 */
export function slotKey(id, date, slot) {
  return `${id}|${date}|${slot}`
}

/**
 * 确定性合成读数：只依赖点位参数与时段，反复生成结果一致。
 * @param {Record<string, number>} point
 * @param {string} date
 * @param {string} slot
 * @param {string[]} slotNames
 */
export function syntheticReading(point, date, slot, slotNames) {
  const slotIndex = slotNames.indexOf(slot)
  const t = dayIndexOfYear(date) + slotIndex * 0.5
  const phase = 2 * Math.PI * (t - point.相位日) / 30.5
  const wave = Math.sin(phase)
  const ripple = Math.sin(2 * Math.PI * t / 7 + 1.7)
  return {
    测压管水位: round2(point.水位基准 + point.年变幅水位 * (wave + 0.08 * ripple)),
    渗流量: round2(point.渗流量基准 + point.年变幅渗流量 * (wave + 0.08 * ripple)),
    扬压力: round2(point.扬压力基准 + point.年变幅扬压力 * (wave + 0.08 * ripple)),
  }
}

/** 判定预警/报警：任一指标达报警线即报警，否则任一达预警线即预警。 */
export function evaluateStatus(values, thresholds) {
  let hitWarn = false
  for (const [metric, value] of Object.entries(values)) {
    if (value === '' || value === null || value === undefined) continue
    const rule = thresholds[metric]
    if (!rule) continue
    if (Number(value) >= rule.alarm) return { status: '报警', abnormal: true }
    if (Number(value) >= rule.warn) hitWarn = true
  }
  return hitWarn ? { status: '预警', abnormal: false } : { status: '正常', abnormal: false }
}

export function thresholdsText(thresholds) {
  const level = thresholds.测压管水位
  const flow = thresholds.渗流量
  const pressure = thresholds.扬压力
  return `水位${level.warn}/${level.alarm}m；流量${flow.warn}/${flow.alarm}L/s；扬压力${pressure.warn}/${pressure.alarm}kPa`
}

/** 对数值列求和：空串/非数值不计入（三天以上保留缺测的记录自然被排除）。 */
export function sumMetric(rows, field) {
  const total = rows.reduce((sum, row) => {
    const value = row[field]
    if (value === '' || value === null || value === undefined) return sum
    const num = Number(value)
    return Number.isFinite(num) ? sum + num : sum
  }, 0)
  return round2(total)
}

/**
 * 按登记键去重，只认第一次取值，后到的按重复处理丢弃；返回稳定顺序的新数组。
 * 前端初始化/重装后反复调用也不会多出重复测点。
 * @param {Array<Record<string, unknown>>} rows
 * @param {string[]} keyFields
 */
export function dedupeByKey(rows, keyFields) {
  const seen = new Set()
  const kept = []
  for (const row of rows) {
    const key = keyFields.map((field) => String(row[field] ?? '')).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(row)
  }
  return kept
}

/** 规范化渗流行：去重 + 按测点、监测日期、监测时段稳定排序。 */
export function canonicalizeSeepageRows(rows, policy) {
  const unique = dedupeByKey(rows, policy.dedupeKey)
  const slotOrder = policy.window.slotNames
  return [...unique].sort((a, b) => {
    const byPoint = String(a.测点编号).localeCompare(String(b.测点编号))
    if (byPoint !== 0) return byPoint
    const byDate = String(a.监测日期).localeCompare(String(b.监测日期))
    if (byDate !== 0) return byDate
    return slotOrder.indexOf(String(a.监测时段)) - slotOrder.indexOf(String(b.监测时段))
  })
}

function linearFill(before, after, step, steps, metric) {
  return before === null || after === null
    ? null
    : before + ((after - before) * step) / (steps + 1)
}

function metricScale(metric) {
  return metric === '扬压力' ? 10 : 100
}

/**
 * 按统一口径从基础点位 + 示例观测重建渗流初始化数据。
 * @returns {{
 *   entries: Array<Record<string, unknown>>,
 *   rawRows: Array<Record<string, unknown>>,
 *   rejectedDuplicates: Array<Record<string, unknown>>,
 *   counts: Record<string, number>,
 *   totals: Record<string, number>,
 * }}
 */
export function buildSeepage({ policy, pointsDoc, sampleDoc }) {
  const metrics = ['测压管水位', '渗流量', '扬压力']
  const points = pointsDoc.points
  const slots = enumerateSlots(policy.window)

  // 缺测时段表：键 -> 分档（halfDay / oneDay / longGap）
  const missingMap = new Map()
  for (const span of sampleDoc.missingSpans ?? []) {
    for (const item of span.slots) {
      missingMap.set(slotKey(span.测点编号, item.date, item.slot), span.tier)
    }
  }

  // 后到的重复提交：记录留痕，取值拒收
  const duplicateMap = new Map()
  const rejectedDuplicates = []
  for (const dup of sampleDoc.duplicateSubmissions ?? []) {
    const key = slotKey(dup.测点编号, dup.监测日期, dup.监测时段)
    duplicateMap.set(key, dup.重复取值)
    rejectedDuplicates.push({
      测点编号: dup.测点编号,
      监测日期: dup.监测日期,
      监测时段: dup.监测时段,
      拒收测压管水位: dup.重复取值.测压管水位,
      拒收渗流量: dup.重复取值.渗流量,
      拒收扬压力: dup.重复取值.扬压力,
      拒收原因: '重复提交：登记键已存在，只认第一次取值',
      说明: dup.说明 ?? '',
    })
  }

  // 早期无监测日期的存量记录：按测点编号+原始登记顺序回填到该测点最早可用时段
  const legacyByPoint = new Map()
  for (const legacy of sampleDoc.legacyRecords ?? []) {
    const list = legacyByPoint.get(legacy.测点编号) ?? []
    list.push(legacy)
    legacyByPoint.set(legacy.测点编号, list)
  }
  const legacySlotMap = new Map()
  for (const [pointId, list] of legacyByPoint) {
    list.sort((a, b) => a.登记顺序 - b.登记顺序)
    const freeSlots = slots.filter(
      (item) => !missingMap.has(slotKey(pointId, item.date, item.slot)),
    )
    list.forEach((legacy, i) => {
      const target = freeSlots[i]
      if (target) legacySlotMap.set(slotKey(pointId, target.date, target.slot), legacy)
    })
  }

  const warningText = thresholdsText(policy.thresholds)
  const entries = []
  const rawRows = []
  const counts = {
    slotsTotal: 0,
    measured: 0,
    interpolatedHalfDay: 0,
    interpolatedOneDay: 0,
    keptMissing: 0,
    legacyBackfilled: 0,
    rejectedDuplicates: rejectedDuplicates.length,
    status正常: 0,
    status预警: 0,
    status报警: 0,
  }

  for (const point of points) {
    // 先铺该测点的原始序列（null 表示该时段无读数）
    const series = slots.map((item) => {
      const key = slotKey(point.测点编号, item.date, item.slot)
      let values
      let source
      let rawNote = ''
      if (missingMap.has(key)) {
        values = null
        source = '缺测'
      } else if (legacySlotMap.has(key)) {
        const legacy = legacySlotMap.get(key)
        values = { 测压管水位: legacy.测压管水位, 渗流量: legacy.渗流量, 扬压力: legacy.扬压力 }
        source = 'legacy'
        rawNote = legacy.来源说明
      } else {
        values = syntheticReading(point, item.date, item.slot, policy.window.slotNames)
        source = 'measured'
      }
      return { ...item, key, values, source, rawNote, fillTier: null }
    })

    // 连续中断分档补缺（线性内插仅在前后都有有效读数时生效）
    for (let i = 0; i < series.length; i += 1) {
      if (series[i].values !== null) continue
      const start = i
      while (i < series.length && series[i].values === null) i += 1
      const end = i // 首个有效位置
      const gap = end - start
      const before = start > 0 ? series[start - 1].values : null
      const after = end < series.length ? series[end].values : null
      const bounded = Boolean(before && after)
      if (bounded && gap === policy.gapTiers.halfDay.maxSlots) {
        for (let k = start; k < end; k += 1) series[k].fillTier = 'halfDay'
      } else if (
        bounded &&
        gap >= policy.gapTiers.oneDay.minSlots &&
        gap <= policy.gapTiers.oneDay.maxSlots
      ) {
        for (let k = start; k < end; k += 1) series[k].fillTier = 'oneDay'
      } else {
        for (let k = start; k < end; k += 1) series[k].fillTier = 'longGap'
      }
      for (let k = start; k < end; k += 1) {
        if (series[k].fillTier === 'longGap') continue
        const step = k - start + 1
        const filled = {}
        for (const metric of metrics) {
          const scale = metricScale(metric)
          filled[metric] =
            Math.round(linearFill(before[metric], after[metric], step, gap, metric) * scale) /
            scale
        }
        series[k].values = filled
      }
    }

    for (const item of series) {
      const missing = item.values === null
      const legacy = item.source === 'legacy'
      const interpolated = item.fillTier === 'halfDay' || item.fillTier === 'oneDay'
      const originallyMissing = missingMap.has(item.key)
      const duplicatePayload = duplicateMap.get(item.key)

      let 测点状态
      let 缺测处理 = ''
      let 数据来源
      if (missing) {
        测点状态 = '缺测（三天以上）'
        缺测处理 = '三天以上：保留缺测，不补数值'
        数据来源 = '示例观测'
        counts.keptMissing += 1
      } else if (legacy) {
        测点状态 = '存量回填（早期无监测日期，按登记顺序）'
        数据来源 = '存量台账回填'
        counts.legacyBackfilled += 1
      } else if (item.fillTier === 'halfDay') {
        测点状态 = '内插补齐（半天）'
        缺测处理 = '半天：相邻时段线性内插'
        数据来源 = '示例观测·内插'
        counts.interpolatedHalfDay += 1
      } else if (item.fillTier === 'oneDay') {
        测点状态 = '内插补齐（一天）'
        缺测处理 = '一天：前后有效读数线性内插'
        数据来源 = '示例观测·内插'
        counts.interpolatedOneDay += 1
      } else {
        测点状态 = '实测'
        数据来源 = '示例观测·实测'
        counts.measured += 1
      }

      const values = missing
        ? { 测压管水位: '', 渗流量: '', 扬压力: '' }
        : item.values
      const verdict = missing
        ? { status: '正常', abnormal: false }
        : evaluateStatus(values, policy.thresholds)
      const pending = verdict.status === '预警' || verdict.status === '报警'
      counts[`status${verdict.status}`] += 1

      entries.push({
        测点编号: point.测点编号,
        测点位置: point.测点位置,
        监测日期: item.date,
        监测时段: item.slot,
        测压管水位: values.测压管水位,
        渗流量: values.渗流量,
        扬压力: values.扬压力,
        警戒数值: warningText,
        测点状态,
        原始缺测: originallyMissing ? '是' : '否',
        缺测处理,
        数据来源,
        status: verdict.status,
        pending,
        abnormal: verdict.abnormal,
      })

      // 另存用的原始观测行：缺测留空，含被拒收的重复提交（见后面追加）
      rawRows.push({
        测点编号: point.测点编号,
        测点位置: point.测点位置,
        监测日期: item.date,
        监测时段: item.slot,
        测压管水位: values.测压管水位,
        渗流量: values.渗流量,
        扬压力: values.扬压力,
        数据来源:
          item.source === 'legacy'
            ? '存量台账（缺监测日期，待回填）'
            : missingMap.has(item.key)
              ? '缺测'
              : '示例原始观测',
        备注: item.rawNote,
      })
      counts.slotsTotal += 1

      if (duplicatePayload) {
        rawRows.push({
          测点编号: point.测点编号,
          测点位置: point.测点位置,
          监测日期: item.date,
          监测时段: item.slot,
          测压管水位: duplicatePayload.测压管水位,
          渗流量: duplicatePayload.渗流量,
          扬压力: duplicatePayload.扬压力,
          数据来源: '重复提交（拒收，只认第一次取值）',
          备注: '同一登记键后到，按重复处理，不进入初始化台账',
        })
      }
    }
  }

  const canonical = canonicalizeSeepageRows(entries, policy).map((row, index) => ({
    id: index + 1,
    ...row,
  }))

  return {
    entries: canonical,
    rawRows,
    rejectedDuplicates,
    counts,
    totals: {
      渗流量: sumMetric(canonical, '渗流量'),
      扬压力: sumMetric(canonical, '扬压力'),
      有效读数条数: canonical.filter((row) => row.测压管水位 !== '').length,
    },
  }
}
