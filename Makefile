.PHONY: install seed build frontend verify

install:
	cd frontend && npm install

# 重新生成渗流/导轴承初始化产物与另存核对文件（基础数据+示例数据 -> generated-seed.json / data/export）
seed:
	cd frontend && npm run seed:build

# 校验已提交产物与口径重算结果一致（本地与部署的渗流量、扬压力总数对得上）
verify:
	cd frontend && npm run seed:check

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build
