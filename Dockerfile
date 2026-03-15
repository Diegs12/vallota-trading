FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

# Remove sensitive files that should never be in the container
RUN rm -f .env wallet-seed.json cdp_api_key.json

# Create data directory and set ownership
RUN mkdir -p data && chown -R node:node /app

EXPOSE 3333

# Use entrypoint script to fix volume permissions at runtime, then start as node
CMD ["bash", "-c", "chown -R node:node /app/data 2>/dev/null; exec su -s /bin/bash node -c 'node src/bot.js start'"]
