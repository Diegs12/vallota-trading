FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

# Remove sensitive files that should never be in the container
RUN rm -f .env wallet-seed.json cdp_api_key.json

# Create data directory for trade logs and set ownership
RUN mkdir -p data && chown -R node:node /app

# Run as non-root user
USER node

EXPOSE 3333

CMD ["node", "src/bot.js", "start"]
