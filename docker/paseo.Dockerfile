FROM node:20-slim

# Install git (required by Claude Code for worktrees/git operations)
RUN apt-get update && apt-get install -y git wget && rm -rf /var/lib/apt/lists/*

# Install Paseo CLI and Claude Code globally
RUN npm install -g @getpaseo/cli @anthropic-ai/claude-code

# Create paseo home directory
RUN mkdir -p /root/.paseo

# Set working directory for agents
RUN mkdir -p /workspace
WORKDIR /workspace

# Default environment
ENV PASEO_LISTEN=0.0.0.0:6767
ENV PASEO_HOME=/root/.paseo

EXPOSE 6767

CMD ["paseo", "daemon", "start", "--foreground"]
