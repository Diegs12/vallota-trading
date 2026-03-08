FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

# Create data directory for trade logs
RUN mkdir -p data

EXPOSE 3333

CMD ["node", "src/bot.js", "start"]
