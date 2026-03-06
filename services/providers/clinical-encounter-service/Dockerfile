FROM node:20-alpine AS deps
WORKDIR /app
COPY services/providers/clinical-encounter-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8105
COPY --from=deps /app/node_modules ./node_modules
COPY services/providers/clinical-encounter-service/package*.json ./
COPY services/providers/clinical-encounter-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8105
CMD ["node", "src/server.js"]

