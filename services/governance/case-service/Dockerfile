FROM node:20-alpine AS deps
WORKDIR /app
COPY services/governance/case-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8110
COPY --from=deps /app/node_modules ./node_modules
COPY services/governance/case-service/package*.json ./
COPY services/governance/case-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8110
CMD ["node", "src/server.js"]

