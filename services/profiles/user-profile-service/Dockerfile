FROM node:20-alpine AS builder
WORKDIR /app
COPY src ./src
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8092
COPY --from=builder /app/src ./src
EXPOSE 8092
CMD ["node", "src/server.js"]
