FROM node:20-alpine AS deps
WORKDIR /app
COPY services/providers/laboratory-result-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8106
COPY --from=deps /app/node_modules ./node_modules
COPY services/providers/laboratory-result-service/package*.json ./
COPY services/providers/laboratory-result-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8106
CMD ["node", "src/server.js"]

