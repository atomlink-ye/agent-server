FROM node:20-slim

# Install system deps
RUN apt-get update && apt-get install -y git wget bash && rm -rf /var/lib/apt/lists/*

# Install Paseo CLI and Claude Code globally
RUN npm install -g @getpaseo/cli @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Install agent-server dependencies
COPY package.json ./
RUN npm install

# Build agent-server
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Create non-root user
RUN useradd -m -s /bin/bash agent

# Create workspace and paseo home
RUN mkdir -p /workspace /home/agent/.paseo && chown -R agent:agent /workspace /home/agent/.paseo /app

# Copy paseo config
COPY config/paseo-config.json /home/agent/.paseo/config.json
RUN chown agent:agent /home/agent/.paseo/config.json

# Copy startup script
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh

# Switch to non-root user
USER agent
WORKDIR /workspace

# Environment defaults
ENV PASEO_LISTEN=0.0.0.0:6767
ENV PASEO_HOME=/home/agent/.paseo
ENV PASEO_WS_URL=ws://127.0.0.1:6767/ws
ENV PORT=3000
ENV HOME=/home/agent

EXPOSE 3000 6767

CMD ["/start.sh"]
