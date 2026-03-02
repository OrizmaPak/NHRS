FROM node:20-alpine AS builder
WORKDIR /app
COPY src ./src
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8097
COPY --from=builder /app/src ./src
EXPOSE 8097
CMD ["node", "src/server.js"]
