FROM node:22-alpine3.21

WORKDIR /app

# Update base packages to pull latest security fixes
RUN apk update && apk upgrade --no-cache

# Install dependencies first (separate layer for caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Ensure results directory exists
RUN mkdir -p results && chown -R node:node /app

USER node

CMD ["npm", "start"]
