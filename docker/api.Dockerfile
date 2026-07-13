FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/templates/package.json packages/templates/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN ./node_modules/.bin/prisma generate
EXPOSE 3001
