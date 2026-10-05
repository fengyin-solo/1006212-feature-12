# ---- 构建阶段：与本地开发同一条流水线（依赖安装 -> 口径校验 -> 生产构建）----
FROM node:20-alpine AS build
WORKDIR /srv/web
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# 校验已提交的初始化产物与当前口径重算结果一致（渗流量/扬压力总数对得上），再构建
RUN npm run build

# ---- 运行阶段：只读静态产物，本地开发与部署读同一份初始化数据 ----
FROM nginx:1.27-alpine
COPY --from=build /srv/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
