FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

# Su Fly il database SQLite sta sul volume montato in /data: il file che Prisma
# cerca (prisma/dev.sqlite) diventa un collegamento a quel volume, così le
# sessioni dei negozi restano dopo ogni riavvio o nuovo deploy.
CMD ["sh", "-c", "mkdir -p /data && ln -sf /data/dev.sqlite /app/prisma/dev.sqlite && npm run docker-start"]
