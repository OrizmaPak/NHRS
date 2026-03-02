FROM node:20-alpine AS builder
WORKDIR /app
COPY src ./src
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8083
COPY --from=builder /app/src ./src
EXPOSE 8083
CMD ["node", "src/server.js"]
