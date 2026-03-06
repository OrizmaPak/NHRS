FROM node:20-alpine AS deps
WORKDIR /app
COPY services/providers/pharmacy-dispense-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8107
COPY --from=deps /app/node_modules ./node_modules
COPY services/providers/pharmacy-dispense-service/package*.json ./
COPY services/providers/pharmacy-dispense-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8107
CMD ["node", "src/server.js"]

