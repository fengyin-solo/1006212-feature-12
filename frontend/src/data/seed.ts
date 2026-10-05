import seepageRows from '../../data/generated/seed-seepage.json'
import stationRows from '../../data/generated/seed-station.json'
import unitRows from '../../data/generated/seed-unit.json'
import bearingRows from '../../data/generated/seed-bearing.json'
import manifest from '../../data/generated/manifest.json'
import { STATIC_SEED_ROWS } from './static-seed'
import type { EntryRow } from './types'

// 初始数据：渗流/电站台账/机组运行/导轴承四个模块由生成流水线从 data/base 重建，
// 产物在 data/generated（已提交进仓库），本地 dev 与部署构建读同一份文件。
// 重建方式见 README「初始数据与初始化口径」一节：npm run seed:rebuild。
export const SEED_ROWS: Record<string, EntryRow[]> = {
  ...STATIC_SEED_ROWS,
  station: stationRows as EntryRow[],
  unit: unitRows as EntryRow[],
  bearing: bearingRows as EntryRow[],
  seepage: seepageRows as EntryRow[],
}

// 渗流初始化口径随产物一起发布：阈值版本、总数、缺测分档与页面统计同源。
export const SEED_MANIFEST = manifest as {
  policyVersion: string
  pointCount: number
  seepageRecordCount: number
  seepageFlowTotal: number
  seepageUpliftTotal: number
  gapBuckets: { halfDay: number; oneDay: number; overThreeDay: number }
  statusCounts: { 正常: number; 预警: number; 报警: number }
  stationCount: number
  unitCount: number
  unitCountByStation: Record<string, number>
  bearingCount: number
  bearingPending: number
}
