FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci

COPY apps/api ./apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production

EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "@gtm/api"]
