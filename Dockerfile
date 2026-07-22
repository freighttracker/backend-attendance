FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p logs uploads/avatars uploads/documents

ENV NODE_ENV=production

# Cloud Run injects PORT at runtime; the app already reads process.env.PORT
EXPOSE 8080

CMD ["node", "src/server.js"]
