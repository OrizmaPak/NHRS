FROM node:20-alpine AS deps
WORKDIR /app
COPY services/providers/organization-service/package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8093
COPY --from=deps /app/node_modules ./node_modules
COPY services/providers/organization-service/package*.json ./
COPY services/providers/organization-service/src ./src
COPY libs/shared /libs/shared
EXPOSE 8093
CMD ["node", "src/server.js"]

