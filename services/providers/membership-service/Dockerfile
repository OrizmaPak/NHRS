FROM node:20-alpine AS deps
WORKDIR /app
COPY services/providers/membership-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8103
COPY --from=deps /app/node_modules ./node_modules
COPY services/providers/membership-service/package*.json ./
COPY services/providers/membership-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8103
CMD ["node", "src/server.js"]

