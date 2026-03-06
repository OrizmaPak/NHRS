FROM node:20-alpine AS deps
WORKDIR /app
COPY services/core-platform/api-gateway/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY services/core-platform/api-gateway/package*.json ./
COPY services/core-platform/api-gateway/src ./src
COPY libs/shared /libs/shared
EXPOSE 8080
CMD ["node", "src/server.js"]

