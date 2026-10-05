<template>
  <section class="page" data-module="seepage">
    <header class="page-head">
      <div>
        <h2>渗流监测管理</h2>
        <p class="page-desc">维护渗流测点，围绕测点编号、测点位置、测压管水位、渗流量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记渗流测点</button>
        <button class="btn" type="button" @click="triggerImport">导入明细CSV</button>
        <button class="btn" type="button" @click="exportRows">导出渗流监测清单</button>
        <input ref="fileInput" type="file" accept=".csv" hidden @change="onFilePicked" />
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>
    <p class="status-legend">
      初始化口径 {{ policyVersion }}：合计含早期回填，缺测空值不计入；本页共 {{ total }} 条，与另存清单一致。
    </p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showForm" class="filter-bar register-form" @submit.prevent="submitCreate">
      <label class="filter-item">
        <span>测点编号</span>
        <input v-model="form['测点编号']" required placeholder="如 SEEP-0001" />
      </label>
      <label class="filter-item">
        <span>测点位置</span>
        <input v-model="form['测点位置']" placeholder="留空则同测点编号" />
      </label>
      <label class="filter-item">
        <span>监测日期</span>
        <input v-model="form['监测日期']" required type="date" />
      </label>
      <label class="filter-item">
        <span>监测时间</span>
        <select v-model="form['监测时间']" required>
          <option value="08:00">08:00</option>
          <option value="20:00">20:00</option>
        </select>
      </label>
      <label class="filter-item">
        <span>测压管水位(m)</span>
        <input v-model="form['测压管水位']" type="number" step="0.01" />
      </label>
      <label class="filter-item">
        <span>渗流量(L/s)</span>
        <input v-model="form['渗流量']" type="number" step="0.01" />
      </label>
      <label class="filter-item">
        <span>扬压力(kPa)</span>
        <input v-model="form['扬压力']" type="number" step="1" />
      </label>
      <button class="btn primary" type="submit" :disabled="submitting">{{ submitting ? '提交中…' : '提交登记' }}</button>
      <button class="btn ghost" type="button" :disabled="submitting" @click="showForm = false">取消</button>
    </form>

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
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] === undefined ? '缺测' : row[column] }}</td>
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
      <span>共 {{ total }} 条渗流监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  importEntries,
  listEntries,
  moduleMeta,
  registerEntry,
  runAction as applyAction,
  seepageStats,
} from '@/api/local-service'
import { SEED_MANIFEST } from '@/data/seed'
// @ts-ignore 零依赖 ESM 口径文件
import { classifySeepageStatus, warningText } from '../../../scripts/seepage-policy.mjs'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('seepage')
const columns = ["测点编号", "测点位置", "测点断面", "测压管水位", "渗流量", "扬压力", "警戒数值", "监测日期", "监测时间", "原始缺测", "缺测处理", "补测标记", "测点状态"]
const actions = ["提交监测", "发布预警", "确认处理"]
const statuses = ["正常", "预警", "报警", "已处理"]
const policyVersion = SEED_MANIFEST.policyVersion

const rows = ref<EntryRow[]>([])
const allRowsData = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showForm = ref(false)
const submitting = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const emptyForm = () => ({
  '测点编号': '',
  '测点位置': '',
  '测点断面': '',
  '测压管水位': '',
  '渗流量': '',
  '扬压力': '',
  '监测日期': '',
  '监测时间': '08:00',
})
const form = ref<Record<string, string>>(emptyForm())

const stats = computed(() => {
  const summary = seepageStats(allRowsData.value)
  return [
    { label: '在册测点', value: summary.pointCount },
    { label: '监测记录', value: allRowsData.value.length },
    { label: '渗流量合计(L/s)', value: summary.flowTotal },
    { label: '扬压力合计(kPa)', value: summary.upliftTotal },
    { label: '预警/报警', value: summary.warnCount },
    { label: '原始缺测槽位', value: summary.gapCount },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  form.value = emptyForm()
  errorMessage.value = ''
  showForm.value = true
}

// 重复提交只生效一次：提交期间禁用按钮；服务层按「测点编号+监测日期+监测时间」判重，
// 命中已存在记录直接按重复处理，只认第一次的取值。
function submitCreate() {
  if (submitting.value) return
  submitting.value = true
  try {
    const fields: Record<string, string> = { ...form.value }
    const code = fields['测点编号']
    fields['测点位置'] = fields['测点位置'] || code
    fields['警戒数值'] = warningText(code)
    // 状态由统一阈值口径判定，与初始化产物同源，不由页面另写一套
    const status = classifySeepageStatus(code, {
      level: fields['测压管水位'] === '' ? null : Number(fields['测压管水位']),
      flow: fields['渗流量'] === '' ? null : Number(fields['渗流量']),
      uplift: fields['扬压力'] === '' ? null : Number(fields['扬压力']),
    })
    fields['测点状态'] = status
    const result = registerEntry(meta.key, { ...fields, status })
    errorMessage.value = result.message
    if (result.ok) {
      showForm.value = false
      reload()
    }
  } finally {
    submitting.value = false
  }
}

function triggerImport() {
  errorMessage.value = ''
  fileInput.value?.click()
}

// 导入明细与台账字段一致；整批校验通过才一次性写入，失败不改台账（无中间态）。
function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = importEntries(meta.key, String(reader.result ?? ''))
    errorMessage.value = result.message
    if (result.ok) reload()
    input.value = ''
  }
  reader.readAsText(file, 'utf-8')
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
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allRowsData.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '渗流监测列表读取失败'
  }
}

onMounted(reload)
</script>
