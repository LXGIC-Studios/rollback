# @lxgicstudios/rollback

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/rollback.svg)](https://www.npmjs.com/package/@lxgicstudios/rollback)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](https://www.npmjs.com/package/@lxgicstudios/rollback)

Track deployment history and roll back fast. Push tags to record deploys, list your history, and revert to any previous version. Works with Docker, git tags, and PM2.

## Install

```bash
npm install -g @lxgicstudios/rollback
```

Or run directly:

```bash
npx @lxgicstudios/rollback --help
```

## Usage

```bash
# Record a deployment
rollback push myapp:v2.1.0 --type docker --service web

# Record a git tag deploy
rollback push v1.5.3

# Show deployment history
rollback list

# Quick rollback to previous
rollback now --dry-run    # preview first
rollback now              # execute

# Rollback to a specific version
rollback to myapp:v2.0.0

# Check current status
rollback status
```

## Features

- **Push/pop deployment tracking** with timestamps and metadata
- **Auto-detects deploy type** from tag format (Docker, git, PM2)
- **Dry run mode** to preview rollbacks before executing
- **Docker rollback** pulls the previous image and restarts
- **Git rollback** checks out the target tag or commit
- **PM2 rollback** restarts the named process
- **Metadata support** to tag deploys with author, ticket, etc.
- **JSON output** for scripting and automation
- **Zero dependencies** built on Node.js builtins only

## Commands

| Command | Description |
|---------|-------------|
| `push <tag>` | Record a new deployment |
| `list` | Show deployment history |
| `now` | Rollback to the previous deployment |
| `to <tag>` | Rollback to a specific tag |
| `status` | Show current and previous deployment |
| `clear` | Clear all deployment history |

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--type <type>` | Force type: docker, git, pm2, custom | auto-detect |
| `--service <name>` | Service name for docker deploys | none |
| `--dry-run` | Preview without executing | off |
| `--limit <n>` | Entries to show in list | 20 |
| `--meta <key=value>` | Attach metadata (repeatable) | none |
| `--json` | Output as JSON | off |
| `--help` | Show help message | - |

## How It Works

Rollback stores deployment history in `.rollback-history.json` in your project root. Each `push` appends an entry, and `now`/`to` commands read this history to revert.

The tool auto-detects deployment types from the tag format:
- `myapp:v2.0` or `registry.io/app:tag` -> Docker
- `v1.0.0` or `abc1234` (git hash) -> Git
- `pm2:appname` -> PM2

## License

MIT - [LXGIC Studios](https://lxgicstudios.com)
