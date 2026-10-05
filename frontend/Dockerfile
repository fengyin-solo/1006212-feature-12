# syntax=docker/dockerfile:1
# 本地开发与部署构建共用同一条初始化流水线：
#   重建初始数据 → 校验（总数/去重/阈值口径/清单行数）→ 安装依赖 → 构建。
# data/base（基线）与 scripts（口径与生成器）都在镜像内，产物在任何环境都一致。
FROM node:20-alpine AS base
WORKDIR /srv/web
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .

# 部署镜像：重新生成并校验初始数据后构建静态包，nginx 托管同一份产物。
FROM base AS deploy
RUN npm run build
RUN apk add --no-cache nginx \
  && printf 'server {\n  listen 80;\n  root /srv/web/dist;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/http.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# 本地开发镜像：vite dev server，同样先过初始化校验（predev）。
FROM base AS development
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
