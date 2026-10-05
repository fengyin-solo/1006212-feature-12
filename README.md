# 水电站机组运行检修管理平台

面向电站台账、机组运行、调速励磁、主变与闸门、大坝渗流位移监测、机组检修与发电计划的一体化水电站运行检修管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用初始化数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── data/
│   │   ├── base/             初始化基线（基础数据，手工维护）
│   │   ├── generated/        生成器产物（权威初始数据，已提交，dev/部署读同一份）
│   │   └── archive/          旧脏数据留痕快照（authoritative=false，不参与初始化）
│   ├── scripts/
│   │   ├── seepage-policy.mjs  初始化口径：阈值、缺测分档、判定/去重（构建与页面共用）
│   │   ├── build-seed.mjs      基线 → 产物的确定性生成器
│   │   └── verify-seed.mjs     产物校验（构建流水线强制执行）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、登记去重、CSV 导入导出、动作流转
│   ├── src/data/             模块元数据 / 初始数据组装 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── docker-compose.yml        frontend-dev（vite dev）/ frontend（nginx 部署）两个入口
└── Makefile
```

## 启动

```bash
make install      # 或 cd frontend && npm install
make frontend     # 本地开发：predev 会先校验初始化产物，再起 vite
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建（先重建+校验初始数据，再类型检查、打包）：

```bash
make build        # = cd frontend && npm run build
```

容器：`make up-dev` 起本地开发入口，`make up` 起 nginx 部署入口，共用同一个 Dockerfile，
构建时都会跑一遍生成与校验，本地与部署读到的是同一份初始化结果。

## 初始数据与初始化口径

渗流测点的示例数据不是手填的，而是由一条**零依赖、确定性**流水线生成：不读时钟、不读环境变量、
随机数使用固定种子，同一套基线反复重建得到逐字节一致的产物（见 `data/generated/manifest.json`
里的 checksums）。本地开发与部署环境都直接 import 这份已提交的 JSON，不存在本地一套、部署一套。

```text
data/base（基础数据/示例数据，可单独另存核对）
  seepage-points.json   渗流测点台账：测点编号、测点位置、断面、基准值
  seepage-gaps.json     缺测时段安排（观测序列下标区间）
  legacy-seepage.json   早年缺监测日期的存量记录（留痕，按编号顺序回填到观测窗口前）
  stations/units/bearings.json  电站台账、机组清单、导轴承清单
        │  npm run seed:rebuild（build-seed.mjs + verify-seed.mjs）
        ▼
data/generated（权威初始化结果）
  seed-seepage.json / seed-station.json / seed-unit.json / seed-bearing.json
  seepage-records.csv  另存测点清单（行数与页面记录数一致）
  manifest.json        口径版本、总数、缺测分档、校验和
```

- **权威口径**：以 `data/generated/` 为准（policyVersion 记录在 manifest）。`data/archive/` 里的
  旧脏数据快照（"渗流监测样例1"那批占位值）仅作留痕，`authoritative=false`，不进页面、不进统计。
- **观测窗口**：2026-01-01 至 2026-01-31，每日 08:00、20:00 两个测次；6 个在册测点共
  6×31×2=372 条，另加 2 条早期回填，共 **374** 条。
- **缺测分档（连续中断天数）**，补齐但保留 `原始缺测` 标记：
  - **半天**（漏 1 个测次）：线性插补，`补测标记=线性插补`；
  - **一天**（全天 2 个测次）：上次实测值沿用，`补测标记=上次实测沿用`；
  - **三天以上**（≥6 个测次）：按缺测处理，三项指标留空、
    不计入合计，`补测标记=不补`。
  - 分档按连续缺失的测次数判定：1 个测次=半天档，2~5 个测次=一天档（沿用），
    ≥6 个测次=三天以上档（不补）。
- **预警阈值**（测压管水位 m / 渗流量 L/s / 扬压力 kPa）集中在 `scripts/seepage-policy.mjs`
  的 `SEEPAGE_THRESHOLDS`，生成期判定状态与页面运行时判定共用同一份函数：任一指标达报警值→
  报警；达警戒值→预警；缺测指标不参与判定。
- **早年缺监测日期的存量**：按「测点编号升序」回填到正式观测窗口开始日之前的连续测次
  （2025-12-30、2025-12-31 各 08:00），不插值、不补成序列，`缺测处理` 字段注明回填来源。
- **幂等初始化**：生成器按「测点编号+监测日期+监测时间」先到先去重，再稳定排序重排 id；
  localStorage 键带版本（`hydropower-plant-om:entries:v2`），初始化只在键缺失/损坏时整体写入，
  反复初始化不会合并叠加，故不会多出重复测点。
- **登记重复只认第一次**：页面登记与 CSV 导入按同一自然键判重，后到的按重复处理、不覆盖首值；
  导入先整批校验再一次性整表落盘，全部重复或明细列与台账不一致时不改数据，不留中间态。
- **联动总量**：电站台账的「机组台数」由机组清单按所属电站计数反推（2/1/0，合计 3）；
  导轴承待办（温度偏高+待检修，本期 3 只）随检测数据重建；换环境后渗流量、扬压力合计与
  manifest 一致（当前 334.81 L/s、42779.5 kPa），校验脚本会逐项断言。

想回到初始数据：清掉浏览器里 `hydropower-plant-om:entries:v2` 这一项，或调用 `resetModule(模块)`。
想重建产物：改完 `data/base` 后执行 `make seed`（会先重建再校验）。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 电站台账 | `station` | 水电站 | 电站编号、电站名称、装机容量、机组台数 |
| 机组运行 | `unit` | 水轮发电机组 | 机组编号、所属电站、机组型号、额定转速 |
| 调速器 | `governor` | 调速器 | 装置编号、所属机组、油压值 |
| 励磁系统 | `excitation` | 励磁装置 | 装置编号、所属机组、励磁电压 |
| 主变压器 | `transformer` | 主变压器 | 变压器编号、容量等级、油温 |
| 闸门启闭 | `gate` | 闸门 | 闸门编号、闸门类型、孔口尺寸 |
| 渗流监测 | `seepage` | 渗流测点 | 测点编号、测点位置、测压管水位、原始缺测、缺测处理 |
| 位移监测 | `displacement` | 位移测点 | 测点编号、测点高程、水平位移 |
| 拦污栅 | `trashrack` | 拦污栅 | 栅体编号、所属机组、前后压差 |
| 机组检修 | `overhaul` | 检修工作票 | 工作票号、检修机组、检修级别 |
| 导轴承 | `bearing` | 导轴承 | 轴承编号、所属机组、轴承部位、上导温度 |
| 技术供水 | `cooling` | 供水系统 | 系统编号、供水类型、供水压力 |
| 水情调度 | `hydrology` | 水情记录 | 记录编号、观测时间、上游水位 |
| 泄洪操作 | `flood` | 泄洪操作 | 操作编号、泄洪闸号、开启孔数 |
| 发电计划 | `generation` | 发电计划 | 计划编号、计划日期、计划出力 |
| 继电保护 | `protection` | 保护装置 | 装置编号、保护类型、定值单号 |
| 缺陷处置 | `defect` | 设备缺陷 | 缺陷编号、设备名称、缺陷描述 |
| 检修人员 | `crew` | 检修人员 | 人员编号、姓名、岗位 |
| 备品备件 | `spare` | 备品备件 | 备件编号、备件名称、规格型号 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；初始数据由
  `frontend/src/data/seed.ts` 从 `data/generated` 组装。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
