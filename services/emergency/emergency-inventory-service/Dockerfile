FROM node:20-alpine AS deps
WORKDIR /app
COPY services/emergency/emergency-inventory-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8108
COPY --from=deps /app/node_modules ./node_modules
COPY services/emergency/emergency-inventory-service/package*.json ./
COPY services/emergency/emergency-inventory-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8108
CMD ["node", "src/server.js"]

