FROM node:22-slim

WORKDIR /app

# Update base packages to pull latest security fixes
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install dependencies first (separate layer for caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Ensure results directory exists
RUN mkdir -p results && chown -R node:node /app

USER node

CMD ["npm", "start"]
