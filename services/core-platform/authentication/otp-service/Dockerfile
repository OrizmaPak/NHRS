FROM node:20-alpine AS builder
WORKDIR /app
COPY src ./src
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8082
COPY --from=builder /app/src ./src
EXPOSE 8082
CMD ["node", "src/server.js"]
