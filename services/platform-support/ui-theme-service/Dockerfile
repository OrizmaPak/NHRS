FROM node:20-alpine AS deps
WORKDIR /app
COPY services/platform-support/ui-theme-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8111
COPY --from=deps /app/node_modules ./node_modules
COPY services/platform-support/ui-theme-service/package*.json ./
COPY services/platform-support/ui-theme-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8111
CMD ["node", "src/server.js"]

