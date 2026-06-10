# Stage 1: Build the client
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Production server
FROM node:20-slim

# Install ffmpeg for audio processing
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy server source code
COPY server/src/ ./server/src/

# Copy built client from stage 1
COPY --from=client-build /app/client/dist ./client/dist

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create directories for persistent data
RUN mkdir -p /app/server/projects /app/server/uploads

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["./docker-entrypoint.sh"]
