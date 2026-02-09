#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// ── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface DeployEntry {
  tag: string;
  type: "docker" | "git" | "pm2" | "custom";
  timestamp: string;
  service?: string;
  metadata?: Record<string, string>;
}

interface DeployHistory {
  version: number;
  entries: DeployEntry[];
}

// ── History File ─────────────────────────────────────────────────────────────

const HISTORY_FILE = ".rollback-history.json";

function getHistoryPath(): string {
  return path.resolve(process.cwd(), HISTORY_FILE);
}

function loadHistory(): DeployHistory {
  const histPath = getHistoryPath();
  if (!fs.existsSync(histPath)) {
    return { version: 1, entries: [] };
  }
  try {
    const raw = fs.readFileSync(histPath, "utf-8");
    return JSON.parse(raw) as DeployHistory;
  } catch {
    return { version: 1, entries: [] };
  }
}

function saveHistory(history: DeployHistory): void {
  fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2));
}

// ── Type Detection ───────────────────────────────────────────────────────────

function detectType(tag: string): "docker" | "git" | "pm2" | "custom" {
  // Docker: contains `:` with registry/image pattern or looks like a docker tag
  if (tag.includes("/") && tag.includes(":")) return "docker";
  if (tag.match(/^[\w.-]+:[\w.-]+$/)) return "docker";

  // Git: looks like a git hash or semver tag
  if (tag.match(/^[a-f0-9]{7,40}$/)) return "git";
  if (tag.match(/^v?\d+\.\d+/)) return "git";

  // PM2: starts with pm2: prefix
  if (tag.startsWith("pm2:")) return "pm2";

  return "custom";
}

// ── Shell Helpers ────────────────────────────────────────────────────────────

function runCmd(cmd: string, dryRun: boolean): string {
  if (dryRun) {
    console.log(`  ${c.yellow}[DRY RUN]${c.reset} ${c.dim}${cmd}${c.reset}`);
    return "";
  }
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: any) {
    throw new Error(`Command failed: ${cmd}\n${err.stderr ?? err.message}`);
  }
}

// ── Rollback Logic ───────────────────────────────────────────────────────────

function rollbackDocker(current: DeployEntry, target: DeployEntry, dryRun: boolean, service?: string): void {
  console.log(`  ${c.cyan}Docker rollback:${c.reset} ${current.tag} -> ${target.tag}\n`);

  // If it's a full image:tag, pull and restart
  const svc = service ?? target.service ?? "";

  if (target.tag.includes(":")) {
    runCmd(`docker pull ${target.tag}`, dryRun);

    // Try docker-compose first, then plain docker
    if (svc) {
      try {
        runCmd(`docker compose up -d ${svc}`, dryRun);
      } catch {
        console.log(`  ${c.dim}docker compose not available, trying docker run...${c.reset}`);
        runCmd(`docker stop ${svc} || true`, dryRun);
        runCmd(`docker run -d --name ${svc} ${target.tag}`, dryRun);
      }
    }
  }
}

function rollbackGit(current: DeployEntry, target: DeployEntry, dryRun: boolean): void {
  console.log(`  ${c.cyan}Git rollback:${c.reset} ${current.tag} -> ${target.tag}\n`);
  runCmd(`git checkout ${target.tag}`, dryRun);
}

function rollbackPm2(current: DeployEntry, target: DeployEntry, dryRun: boolean): void {
  const appName = target.tag.replace("pm2:", "").split("@")[0];
  console.log(`  ${c.cyan}PM2 rollback:${c.reset} ${current.tag} -> ${target.tag}\n`);
  runCmd(`pm2 restart ${appName}`, dryRun);
}

function performRollback(current: DeployEntry, target: DeployEntry, dryRun: boolean, service?: string): void {
  switch (target.type) {
    case "docker":
      rollbackDocker(current, target, dryRun, service);
      break;
    case "git":
      rollbackGit(current, target, dryRun);
      break;
    case "pm2":
      rollbackPm2(current, target, dryRun);
      break;
    case "custom":
      console.log(`  ${c.yellow}Custom type:${c.reset} Can't auto-rollback. Target tag: ${target.tag}`);
      console.log(`  ${c.dim}Record the tag and run your rollback manually.${c.reset}`);
      break;
  }
}

// ── Display ──────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(`
${c.blue}${c.bold}  ┌─────────────────────────────────┐${c.reset}
${c.blue}${c.bold}  │   ⏪ rollback  v1.0.0            │${c.reset}
${c.blue}${c.bold}  │   Deployment History & Rollback   │${c.reset}
${c.blue}${c.bold}  └─────────────────────────────────┘${c.reset}
`);
}

function typeIcon(type: string): string {
  switch (type) {
    case "docker": return `${c.blue}🐳${c.reset}`;
    case "git": return `${c.green}📦${c.reset}`;
    case "pm2": return `${c.magenta}⚡${c.reset}`;
    default: return `${c.dim}📌${c.reset}`;
  }
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function printList(history: DeployHistory, limit: number): void {
  const entries = history.entries.slice(-limit).reverse();

  if (entries.length === 0) {
    console.log(`  ${c.dim}No deployments recorded yet. Use 'rollback push <tag>' to start.${c.reset}\n`);
    return;
  }

  console.log(`  ${c.bold}${c.cyan}Deployment History${c.reset} ${c.dim}(${history.entries.length} total, showing last ${entries.length})${c.reset}\n`);

  entries.forEach((entry, i) => {
    const isCurrent = i === 0;
    const marker = isCurrent ? `${c.green} CURRENT ${c.reset}` : `         `;
    const svcStr = entry.service ? ` ${c.dim}[${entry.service}]${c.reset}` : "";
    const ago = timeAgo(entry.timestamp);

    console.log(
      `  ${marker} ${typeIcon(entry.type)} ${c.bold}${entry.tag}${c.reset}${svcStr}  ${c.dim}${ago}${c.reset}`
    );

    if (entry.metadata) {
      for (const [key, val] of Object.entries(entry.metadata)) {
        console.log(`             ${c.dim}${key}: ${val}${c.reset}`);
      }
    }
  });

  console.log();
}

function printStatus(history: DeployHistory): void {
  if (history.entries.length === 0) {
    console.log(`  ${c.dim}No deployments tracked.${c.reset}\n`);
    return;
  }

  const current = history.entries[history.entries.length - 1];
  const previous = history.entries.length > 1 ? history.entries[history.entries.length - 2] : null;

  console.log(`  ${c.bold}Current:${c.reset}    ${typeIcon(current.type)} ${c.green}${current.tag}${c.reset}  ${c.dim}${timeAgo(current.timestamp)}${c.reset}`);
  if (previous) {
    console.log(`  ${c.bold}Previous:${c.reset}   ${typeIcon(previous.type)} ${c.yellow}${previous.tag}${c.reset}  ${c.dim}${timeAgo(previous.timestamp)}${c.reset}`);
  }
  console.log(`  ${c.bold}Total deploys:${c.reset} ${history.entries.length}`);

  // Type breakdown
  const types = new Map<string, number>();
  for (const e of history.entries) {
    types.set(e.type, (types.get(e.type) ?? 0) + 1);
  }
  const typeStr = [...types.entries()].map(([t, n]) => `${t}: ${n}`).join(", ");
  console.log(`  ${c.bold}By type:${c.reset}    ${c.dim}${typeStr}${c.reset}\n`);
}

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  printBanner();
  console.log(`${c.bold}USAGE${c.reset}
  ${c.cyan}rollback${c.reset} <command> [options]

${c.bold}COMMANDS${c.reset}
  ${c.green}push${c.reset} <tag>           Record a new deployment
  ${c.green}list${c.reset}                 Show deployment history
  ${c.green}now${c.reset}                  Rollback to the previous deployment
  ${c.green}to${c.reset} <tag>             Rollback to a specific tag
  ${c.green}status${c.reset}               Show current and previous deployment
  ${c.green}clear${c.reset}                Clear deployment history

${c.bold}OPTIONS${c.reset}
  ${c.green}--type${c.reset} <type>        Force deploy type: docker, git, pm2, custom
  ${c.green}--service${c.reset} <name>     Service name (for docker deployments)
  ${c.green}--dry-run${c.reset}            Show what would happen without executing
  ${c.green}--limit${c.reset} <n>          Number of entries to show (default: 20)
  ${c.green}--json${c.reset}               Output as JSON
  ${c.green}--meta${c.reset} <key=value>   Attach metadata to a push
  ${c.green}--help${c.reset}               Show this help message

${c.bold}EXAMPLES${c.reset}
  ${c.dim}# Record a Docker deployment${c.reset}
  $ rollback push myapp:v2.1.0 --type docker --service web

  ${c.dim}# Record a git tag deploy${c.reset}
  $ rollback push v1.5.3

  ${c.dim}# Show recent deployments${c.reset}
  $ rollback list

  ${c.dim}# Rollback to previous (dry run first)${c.reset}
  $ rollback now --dry-run
  $ rollback now

  ${c.dim}# Rollback to a specific version${c.reset}
  $ rollback to myapp:v2.0.0

  ${c.dim}# Push with metadata${c.reset}
  $ rollback push v3.0.0 --meta "author=kai" --meta "ticket=JIRA-123"
`);
}

// ── Arg Parsing ──────────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  meta: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const meta: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--meta") {
      const val = argv[++i];
      if (val) {
        const eqIdx = val.indexOf("=");
        if (eqIdx > 0) {
          meta[val.slice(0, eqIdx)] = val.slice(eqIdx + 1);
        }
      }
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  const command = positional.shift() ?? "";
  return { command, positional, flags, meta };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const { command, positional, flags, meta } = parseArgs(process.argv.slice(2));

  if (flags["help"] || command === "help" || command === "") {
    printHelp();
    process.exit(0);
  }

  const jsonMode = flags["json"] === true;
  const dryRun = flags["dry-run"] === true;
  const limit = typeof flags["limit"] === "string" ? parseInt(flags["limit"], 10) : 20;
  const forcedType = flags["type"] as string | undefined;
  const service = flags["service"] as string | undefined;

  const history = loadHistory();

  switch (command) {
    case "push": {
      const tag = positional[0];
      if (!tag) {
        console.error(`${c.red}Error: Provide a tag. Example: rollback push v1.0.0${c.reset}`);
        process.exit(1);
      }

      const type = (forcedType as DeployEntry["type"]) ?? detectType(tag);
      const entry: DeployEntry = {
        tag,
        type,
        timestamp: new Date().toISOString(),
        service,
        metadata: Object.keys(meta).length > 0 ? meta : undefined,
      };

      history.entries.push(entry);
      saveHistory(history);

      if (jsonMode) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        printBanner();
        console.log(`  ${c.green}${c.bold}Recorded deployment${c.reset}\n`);
        console.log(`  ${c.bold}Tag:${c.reset}      ${typeIcon(type)} ${tag}`);
        console.log(`  ${c.bold}Type:${c.reset}     ${type}`);
        if (service) console.log(`  ${c.bold}Service:${c.reset}  ${service}`);
        console.log(`  ${c.bold}Deploy #:${c.reset} ${history.entries.length}`);
        if (entry.metadata) {
          for (const [k, v] of Object.entries(entry.metadata)) {
            console.log(`  ${c.bold}${k}:${c.reset}  ${v}`);
          }
        }
        console.log();
      }
      break;
    }

    case "list": {
      if (jsonMode) {
        const entries = history.entries.slice(-limit).reverse();
        console.log(JSON.stringify(entries, null, 2));
      } else {
        printBanner();
        printList(history, limit);
      }
      break;
    }

    case "status": {
      if (jsonMode) {
        const current = history.entries[history.entries.length - 1] ?? null;
        const previous = history.entries.length > 1 ? history.entries[history.entries.length - 2] : null;
        console.log(JSON.stringify({ current, previous, totalDeploys: history.entries.length }, null, 2));
      } else {
        printBanner();
        printStatus(history);
      }
      break;
    }

    case "now": {
      if (history.entries.length < 2) {
        console.error(`${c.red}Error: Need at least 2 deployments to rollback. Current: ${history.entries.length}.${c.reset}`);
        process.exit(1);
      }

      const current = history.entries[history.entries.length - 1];
      const target = history.entries[history.entries.length - 2];

      if (!jsonMode) {
        printBanner();
        if (dryRun) {
          console.log(`  ${c.yellow}${c.bold}DRY RUN${c.reset} - Nothing will be executed.\n`);
        }
        console.log(`  ${c.bold}Rolling back:${c.reset} ${c.red}${current.tag}${c.reset} -> ${c.green}${target.tag}${c.reset}\n`);
      }

      try {
        performRollback(current, target, dryRun, service);

        // Record the rollback as a new deployment
        if (!dryRun) {
          const rollbackEntry: DeployEntry = {
            tag: target.tag,
            type: target.type,
            timestamp: new Date().toISOString(),
            service: service ?? target.service,
            metadata: { rollbackFrom: current.tag },
          };
          history.entries.push(rollbackEntry);
          saveHistory(history);
        }

        if (jsonMode) {
          console.log(JSON.stringify({
            action: "rollback",
            from: current.tag,
            to: target.tag,
            dryRun,
            success: true,
          }, null, 2));
        } else {
          console.log(`\n  ${c.green}${c.bold}Rollback complete!${c.reset}\n`);
        }
      } catch (err: any) {
        if (jsonMode) {
          console.log(JSON.stringify({ action: "rollback", success: false, error: err.message }, null, 2));
        } else {
          console.error(`\n  ${c.red}Rollback failed: ${err.message}${c.reset}\n`);
        }
        process.exit(1);
      }
      break;
    }

    case "to": {
      const targetTag = positional[0];
      if (!targetTag) {
        console.error(`${c.red}Error: Provide a tag. Example: rollback to v1.0.0${c.reset}`);
        process.exit(1);
      }

      const targetEntry = [...history.entries].reverse().find((e) => e.tag === targetTag);
      if (!targetEntry) {
        console.error(`${c.red}Error: Tag "${targetTag}" not found in history.${c.reset}`);
        process.exit(1);
      }

      const current = history.entries[history.entries.length - 1];

      if (!jsonMode) {
        printBanner();
        if (dryRun) {
          console.log(`  ${c.yellow}${c.bold}DRY RUN${c.reset} - Nothing will be executed.\n`);
        }
        console.log(`  ${c.bold}Rolling back:${c.reset} ${c.red}${current.tag}${c.reset} -> ${c.green}${targetTag}${c.reset}\n`);
      }

      try {
        performRollback(current, targetEntry, dryRun, service);

        if (!dryRun) {
          const rollbackEntry: DeployEntry = {
            tag: targetEntry.tag,
            type: targetEntry.type,
            timestamp: new Date().toISOString(),
            service: service ?? targetEntry.service,
            metadata: { rollbackFrom: current.tag },
          };
          history.entries.push(rollbackEntry);
          saveHistory(history);
        }

        if (jsonMode) {
          console.log(JSON.stringify({
            action: "rollback",
            from: current.tag,
            to: targetTag,
            dryRun,
            success: true,
          }, null, 2));
        } else {
          console.log(`\n  ${c.green}${c.bold}Rollback complete!${c.reset}\n`);
        }
      } catch (err: any) {
        if (jsonMode) {
          console.log(JSON.stringify({ action: "rollback", success: false, error: err.message }, null, 2));
        } else {
          console.error(`\n  ${c.red}Rollback failed: ${err.message}${c.reset}\n`);
        }
        process.exit(1);
      }
      break;
    }

    case "clear": {
      if (dryRun) {
        console.log(`  ${c.yellow}[DRY RUN]${c.reset} Would clear ${history.entries.length} entries.`);
      } else {
        const count = history.entries.length;
        history.entries = [];
        saveHistory(history);
        if (jsonMode) {
          console.log(JSON.stringify({ action: "clear", entriesCleared: count }, null, 2));
        } else {
          printBanner();
          console.log(`  ${c.green}Cleared ${count} deployment entries.${c.reset}\n`);
        }
      }
      break;
    }

    default:
      console.error(`${c.red}Unknown command: ${command}. Use --help to see available commands.${c.reset}`);
      process.exit(1);
  }
}

main();
