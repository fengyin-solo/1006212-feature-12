<template>
  <section class="page" data-module="seepage">
    <header class="page-head">
      <div>
        <h2>渗流监测管理</h2>
        <p class="page-desc">按测点位置与监测日期（每日上午/下午两个时段）重建的初始化数据；缺测按半天、一天、三天以上分档处理并保留原始缺测标记。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记渗流测点</button>
        <button class="btn" type="button" @click="exportRows">导出渗流监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p class="threshold-note">预警阈值口径（本地与部署同一套）：{{ thresholdText }}｜口径版本 {{ seedVersion }}</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无渗流监测数据，可先登记渗流测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条渗流监测记录，与另存清单 data/export/seepage-records.processed.csv 记录数一致</span>
      <span :class="totalsMatch ? 'ok-text' : 'error-text'">
        渗流量合计 {{ liveTotals.flow }} L/s、扬压力合计 {{ liveTotals.pressure }} kPa
        （初始化口径：{{ seedTotals.flow }} / {{ seedTotals.pressure }}，{{ totalsMatch ? '一致' : '不一致' }}）
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listAllRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import generatedSeed from '@/data/generated-seed.json'
import { sumMetric, thresholdsText } from '@/data/seepage/seepage-core'
import policy from '@/data/seepage/policy.json'
import { seedVersion } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('seepage')
const columns = ["测点编号", "测点位置", "监测日期", "监测时段", "测压管水位", "渗流量", "扬压力", "警戒数值", "测点状态", "原始缺测", "缺测处理", "数据来源"]
const actions = ["提交监测", "发布预警", "确认处理"]
const statuses = ["正常", "预警", "报警", "已处理"]

const rows = ref<EntryRow[]>([])
const allRowsRef = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["测点编号", "测点位置", "监测日期"]

const thresholdText = thresholdsText(policy.thresholds)
const seedTotals = {
  flow: Number(generatedSeed.seepage.totals.渗流量),
  pressure: Number(generatedSeed.seepage.totals.扬压力),
}

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const liveTotals = computed(() => ({
  flow: sumMetric(allRowsRef.value, '渗流量'),
  pressure: sumMetric(allRowsRef.value, '扬压力'),
}))

const totalsMatch = computed(
  () =>
    liveTotals.value.flow === seedTotals.flow &&
    liveTotals.value.pressure === seedTotals.pressure,
)

const stats = computed(() => {
  const all = allRowsRef.value
  return [
    { label: '记录总数', value: all.length },
    { label: '正常测点', value: all.filter((row) => row.status === '正常').length },
    { label: '预警测点', value: all.filter((row) => row.status === '预警').length },
    { label: '报警测点', value: all.filter((row) => row.status === '报警').length },
    { label: '渗流量合计(L/s)', value: liveTotals.value.flow },
    { label: '扬压力合计(kPa)', value: liveTotals.value.pressure },
  ]
})

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === '' || value === null || value === undefined) return '缺测'
  return String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '渗流测点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    allRowsRef.value = listAllRows(meta.key)
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '渗流监测列表读取失败'
  }
}

onMounted(reload)
</script>
