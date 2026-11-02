# ---- 构建阶段 ----
FROM node:24-alpine AS builder
WORKDIR /app

# 先只拷贝清单，最大化利用缓存
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts

COPY . .
RUN DATABASE_URL=file:./build-schema.db npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @qgauss/api \
 && npm run build -w @qgauss/web

# ---- 运行阶段 ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=9520
ENV API_PREFIX=api

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/scripts/operations ./apps/api/scripts/operations
COPY --from=builder /app/apps/api/tsconfig.json ./apps/api/tsconfig.json
# seed.ts 共用环境校验，运行时 seed 也需要该源文件
COPY --from=builder /app/apps/api/src/common/config/env.check.ts ./apps/api/src/common/config/env.check.ts
COPY --from=builder /app/apps/api/src/common/security/password-policy.ts ./apps/api/src/common/security/password-policy.ts
COPY --from=builder /app/apps/api/src/modules/installation/seed-administrator.ts ./apps/api/src/modules/installation/seed-administrator.ts
COPY --from=builder /app/apps/web/dist ./apps/web/dist

WORKDIR /app/apps/api
# WEB_DIST 指向构建产物；API 同时托管前端
ENV WEB_DIST=/app/apps/web/dist

EXPOSE 9520
# 启动前先跑迁移（幂等），再起服务
CMD ["sh", "-c", "node prisma/migrate.mjs && node dist/main.js"]
