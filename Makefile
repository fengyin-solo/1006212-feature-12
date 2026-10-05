.PHONY: install frontend frontend-deploy build seed verify

install:
	cd frontend && npm install

# 重建并校验初始数据（基线 data/base → 产物 data/generated）
seed:
	cd frontend && npm run seed:rebuild

verify:
	cd frontend && npm run seed:verify

# 本地开发：predev 自动校验初始化产物，与部署构建走同一条流水线
frontend:
	cd frontend && npm run dev

# 部署构建：重建+校验初始数据 → 类型检查 → 静态产物
build:
	cd frontend && npm run build

# 容器：本地开发入口与部署入口共用一个 Dockerfile
up-dev:
	docker compose up --build frontend-dev

up:
	docker compose up --build -d frontend
