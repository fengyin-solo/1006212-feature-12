# 水电站机组运行检修管理平台

面向电站台账、机组运行、调速励磁、主变与闸门、大坝渗流位移监测、机组检修与发电计划的一体化水电站运行检修管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 渗流示例数据与初始化口径（重点）

渗流（`seepage`）不再使用随手填的占位数据，而是按测点位置与监测日期**可重复生成**：

- 口径（数据窗口、缺测分档、预警阈值、去重键、存量回填、权威结论）单一事实源：
  [`frontend/src/data/seepage/policy.json`](frontend/src/data/seepage/policy.json)。
- 基础点位数据：[`points.base.json`](frontend/src/data/seepage/points.base.json)；
  示例观测（缺测时段、重复提交、无日期存量记录）：[`observations.sample.json`](frontend/src/data/seepage/observations.sample.json)。
- 同一份纯逻辑 [`seepage-core.js`](frontend/src/data/seepage/seepage-core.js) 被
  Node 生成脚本与浏览器共用；初始化产物
  [`generated-seed.json`](frontend/src/data/generated-seed.json) 是前端唯一读取的结果，
  **本地开发与部署构建读同一份**。
- 缺测分档：半天（1 个时段）线性内插；一天（2~5 个时段，1 天以上、3 天以内）前后有效读数线性内插；
  三天以上（≥6 个时段）不补值、按缺测保留。补齐记录同时保留「原始缺测」标记。
- 预警阈值收在口径文件里（水位 245/248 m、渗流量 2.5/3.2 L/s、扬压力 180/200 kPa），本地与部署不分叉。
- 重复登记键 = 测点编号 + 监测日期 + 监测时段，只认第一次取值，后到的按重复处理并在
  `data/export/seepage-duplicates.rejected.csv` 留痕；权威结论以处理后的 processed 台账为准，
  原始观测仅留痕。
- localStorage 带口径版本号，口径升级或重装数据层时整版替换旧数据，**不会再回到脏数据**；
  每次读取做幂等去重，反复初始化不会多出重复测点。

详细说明见 [docs/seepage-init-spec.md](docs/seepage-init-spec.md)，可单独核对的基础数据与
示例数据另存在仓库根目录 [`data/export/`](data/export/README.md)（处理后清单记录数与页面一致）。

### 一条流水线

```bash
make seed     # 基础数据 + 示例观测 -> generated-seed.json + data/export（可重复生成，整体写盘无中间态）
make verify   # 已提交产物必须 == 当前口径重算结果（渗流量/扬压力总数对得上）
make build    # verify 通过后生产构建
make frontend # 本地开发（predev 自动 verify）
```

部署 `docker compose up -d --build`：多阶段 Dockerfile 里先跑 `npm run build`
（其 `prebuild` 即口径校验），产出静态文件由 nginx 托管，和本地开发共用同一套依赖、构建与初始化数据。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── scripts/              初始化数据生成与校验（build-seepage.mjs / check-seed.mjs）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   │   └── seepage/          渗流初始化口径（policy）、基础数据、示例观测、共享核心逻辑
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── data/export/              基础数据、原始观测、处理后台账、拒收重复的另存核对产物
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 电站台账 | `station` | 水电站 | 电站编号、电站名称、装机容量 |
| 机组运行 | `unit` | 水轮发电机组 | 机组编号、机组型号、额定转速 |
| 调速器 | `governor` | 调速器 | 装置编号、所属机组、油压值 |
| 励磁系统 | `excitation` | 励磁装置 | 装置编号、所属机组、励磁电压 |
| 主变压器 | `transformer` | 主变压器 | 变压器编号、容量等级、油温 |
| 闸门启闭 | `gate` | 闸门 | 闸门编号、闸门类型、孔口尺寸 |
| 渗流监测 | `seepage` | 渗流测点 | 测点编号、测点位置、测压管水位 |
| 位移监测 | `displacement` | 位移测点 | 测点编号、测点高程、水平位移 |
| 拦污栅 | `trashrack` | 拦污栅 | 栅体编号、所属机组、前后压差 |
| 机组检修 | `overhaul` | 检修工作票 | 工作票号、检修机组、检修级别 |
| 导轴承 | `bearing` | 导轴承 | 轴承编号、所属机组、上导温度 |
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
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；除渗流/导轴承由口径脚本生成外，
  其余示例数据在 `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydropower-plant-om:entries`（连同 `:seed-version`），
  或调用 `resetModule(模块)`；渗流重置后仍按同一口径去重规范化。
