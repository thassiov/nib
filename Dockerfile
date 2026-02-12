# ---------- build stage ----------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY client/ client/
COPY server/ server/

RUN npm run build

# ---------- production stage ----------
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY migrations/ migrations/
COPY --from=build /app/dist/ dist/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server/main.js"]
