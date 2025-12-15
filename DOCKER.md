# Docker Deployment Guide

This guide covers how to use better-ccflare with Docker for easy deployment across multiple architectures.

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Pull and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

### Using Docker CLI

```bash
# Pull the latest image
docker pull ghcr.io/tombii/better-ccflare:latest

# Run the container
docker run -d \
  --name better-ccflare \
  -p 8080:8080 \
  -v better-ccflare-data:/data \
  ghcr.io/tombii/better-ccflare:latest
```

## Supported Architectures

The Docker images support the following platforms:
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/aarch64)

Docker will automatically pull the correct image for your architecture.

## Configuration

### Environment Variables

- `BETTER_CCFLARE_DB_PATH` - Database file path (default: `/data/better-ccflare.db`)
- `NODE_ENV` - Environment mode (default: `production`)
- `LOG_LEVEL` - Logging level (optional)

#### Claude Logs Environment Variables

These variables configure the Claude Code usage log parsing feature:

- `CLAUDE_CONFIG_DIR` - Comma-separated paths to Claude config directories inside the container (e.g., `/host-claude,/host-config-claude`)
- `CLAUDE_LOGS_ENABLED` - Enable/disable Claude logs parsing (`true`/`false`, default: `true`)
- `CLAUDE_LOGS_WATCH` - Enable file watching for real-time updates (`true`/`false`, default: `false`)
- `CLAUDE_LOGS_SCAN_ON_STARTUP` - Scan logs when server starts (`true`/`false`, default: `true`)
- `CLAUDE_LOGS_SCAN_INTERVAL_MS` - Interval for periodic scans in milliseconds (default: `60000`)

### Volume Mounts

The container uses `/data` for persistent storage. Mount this volume to persist your database:

```bash
docker run -v /path/on/host:/data ghcr.io/tombii/better-ccflare:latest
```

Or with docker-compose (already configured):

```yaml
volumes:
  - better-ccflare-data:/data
```

## Claude Code Usage Logs

better-ccflare can parse Claude Code's local JSONL log files to provide historical usage analysis. This feature tracks token usage, costs, and sessions from your local Claude Code installations.

### How It Works

Claude Code stores conversation logs in JSONL files at:
- `~/.claude/projects/{project}/{sessionId}.jsonl` (legacy path)
- `~/.config/claude/projects/{project}/{sessionId}.jsonl` (XDG path)

By mounting these directories into the Docker container, better-ccflare can read and analyze your usage history.

### Basic Setup

Add Claude log directories as read-only volume mounts:

```yaml
# docker-compose.yml
services:
  better-ccflare:
    image: ghcr.io/tombii/better-ccflare:latest
    volumes:
      - better-ccflare-data:/data
      # Mount Claude logs from host (read-only)
      - ${HOME}/.claude:/host-claude:ro
      - ${HOME}/.config/claude:/host-config-claude:ro
    environment:
      - BETTER_CCFLARE_DB_PATH=/data/better-ccflare.db
      # Tell the server where to find Claude logs
      - CLAUDE_CONFIG_DIR=/host-claude,/host-config-claude
      - CLAUDE_LOGS_ENABLED=true
      - CLAUDE_LOGS_SCAN_ON_STARTUP=true
```

Or with `docker run`:

```bash
docker run -d \
  --name better-ccflare \
  -p 8080:8080 \
  -v better-ccflare-data:/data \
  -v ~/.claude:/host-claude:ro \
  -v ~/.config/claude:/host-config-claude:ro \
  -e CLAUDE_CONFIG_DIR=/host-claude,/host-config-claude \
  -e CLAUDE_LOGS_ENABLED=true \
  -e CLAUDE_LOGS_SCAN_ON_STARTUP=true \
  ghcr.io/tombii/better-ccflare:latest
```

### Configuration Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CLAUDE_CONFIG_DIR` | - | Comma-separated paths to Claude config directories inside the container |
| `CLAUDE_LOGS_ENABLED` | `true` | Enable/disable the Claude logs feature |
| `CLAUDE_LOGS_WATCH` | `false` | Watch for file changes in real-time |
| `CLAUDE_LOGS_SCAN_ON_STARTUP` | `true` | Scan all logs when the server starts |
| `CLAUDE_LOGS_SCAN_INTERVAL_MS` | `60000` | Interval between periodic scans (milliseconds) |

### Accessing Usage Data

Once configured, access your usage data through the API:

- `GET /api/usage/daily` - Daily aggregated usage
- `GET /api/usage/monthly` - Monthly aggregated usage
- `GET /api/usage/sessions` - Session-based usage
- `GET /api/usage/blocks` - 5-hour billing block usage
- `GET /api/usage/projects` - List of projects
- `GET /api/usage/summary` - Overall usage summary
- `POST /api/usage/scan` - Manually trigger a scan

### Multiple Machines

To aggregate logs from multiple machines, sync the Claude log directories to your Docker host:

```bash
# Example: rsync logs from remote machines to a central location
rsync -avz user@machine1:~/.claude/projects/ ~/claude-logs/machine1/
rsync -avz user@machine2:~/.claude/projects/ ~/claude-logs/machine2/
```

Then mount the aggregated directory:

```yaml
volumes:
  - ~/claude-logs:/host-claude:ro
environment:
  - CLAUDE_CONFIG_DIR=/host-claude
```

### Troubleshooting

**Logs not being detected:**
```bash
# Verify the volume mount is correct
docker exec better-ccflare ls -la /host-claude

# Check if JSONL files exist
docker exec better-ccflare find /host-claude -name "*.jsonl" | head -10

# Manually trigger a scan and check the response
curl -X POST http://localhost:8080/api/usage/scan
```

**Permission issues:**
```bash
# Ensure the files are readable inside the container
docker exec better-ccflare cat /host-claude/projects/*/some-session.jsonl | head -1
```

The volume mounts use `:ro` (read-only) for security - better-ccflare only reads the log files, never modifies them.

**Scan not finding data:**

Check that your Claude log files are in the expected format. Each line should be valid JSON with fields like:
```json
{"uuid":"...","sessionId":"...","timestamp":"...","message":{"role":"user|assistant","model":"...","usage":{...}},"costUSD":0.0}
```

## Managing Accounts

### Interactive Mode

```bash
# Add an account
docker exec -it better-ccflare better-ccflare --add-account myaccount

# List accounts
docker exec -it better-ccflare better-ccflare --list

# Remove an account
docker exec -it better-ccflare better-ccflare --remove myaccount

# Set priority
docker exec -it better-ccflare better-ccflare --set-priority myaccount 5
```

### Using Volume Mount

Alternatively, you can manage accounts by mounting your existing database:

```bash
docker run -v ~/.config/better-ccflare:/data ghcr.io/tombii/better-ccflare:latest
```

## Building Your Own Images

### Local Build

```bash
# Build for your current architecture
docker build -t better-ccflare:local .

# Run your local build
docker run -p 8080:8080 better-ccflare:local
```

### Multi-Architecture Build

To build for multiple architectures, use Docker Buildx:

```bash
# Create a new builder instance
docker buildx create --name multiarch --use

# Build and push for multiple architectures
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/tombii/better-ccflare:latest \
  --push \
  .
```

## Automated Builds

The repository includes a GitHub Actions workflow that automatically builds and publishes Docker images to GitHub Container Registry (ghcr.io) when you:

1. Push to the `main` branch
2. Create a new tag (e.g., `v1.2.28`)
3. Manually trigger the workflow

### Available Tags

- `latest` - Latest build from main branch
- `v1.2.28` - Specific version tags
- `main-sha-abc123` - Commit SHA tags
- `1.2` - Major.minor version tags
- `1` - Major version tags

## Publishing to Docker Hub (Optional)

To also publish to Docker Hub, add these secrets to your GitHub repository:

1. Go to Settings → Secrets and variables → Actions
2. Add `DOCKERHUB_USERNAME` - Your Docker Hub username
3. Add `DOCKERHUB_TOKEN` - Your Docker Hub access token

The workflow will automatically push to both registries.

## Health Checks

The container includes a health check that runs every 30 seconds:

```bash
# Check container health
docker ps

# View health check logs
docker inspect --format='{{json .State.Health}}' better-ccflare
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs better-ccflare
```

### Database permissions

Ensure the volume has correct permissions:
```bash
docker exec better-ccflare ls -la /data
```

### Port conflicts

If port 8080 is in use, change the host port:
```bash
docker run -p 8081:8080 ghcr.io/tombii/better-ccflare:latest
```

Or in docker-compose.yml:
```yaml
ports:
  - "8081:8080"
```

### Accessing the dashboard

Once running, access the dashboard at:
- `http://localhost:8080` - Web dashboard
- `http://localhost:8080/health` - Health check endpoint

## Resource Limits

The docker-compose.yml includes resource limits. Adjust as needed:

```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 1G
    reservations:
      cpus: '0.5'
      memory: 256M
```

## Production Deployment

### Using Docker Compose in Production

```bash
# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Update to latest version
docker-compose pull
docker-compose up -d

# Backup database
docker cp better-ccflare:/data/better-ccflare.db ./backup-$(date +%Y%m%d).db
```

### Using Orchestration Tools

For production deployments with Kubernetes, see the example manifests in the `/k8s` directory (if available) or adapt the docker-compose.yml to your orchestration tool of choice.

## Security Considerations

1. **Network Security**: Use a reverse proxy (nginx, traefik) with TLS
2. **Database Backups**: Regularly backup the `/data` volume
3. **Updates**: Keep the image updated with `docker-compose pull`
4. **Access Control**: Restrict access to the container's ports using firewall rules

## Next Steps

- Configure your accounts using `docker exec -it better-ccflare better-ccflare --add-account`
- Access the web dashboard at `http://localhost:8080`
- Monitor logs with `docker-compose logs -f`
- Set up automated backups of the `/data` volume
