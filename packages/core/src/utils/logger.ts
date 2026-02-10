// ============================================
// Logger Utility
// ============================================

import * as fs from "fs";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  verbose(message: string): void;
  close(): void;
}

type LogLevel = "debug" | "verbose" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  verbose: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  verbose: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

export function createLogger(options?: {
  level?: LogLevel;
  logFile?: string;
  prefix?: string;
}): Logger {
  const level = options?.level ?? "info";
  const minLevel = LOG_LEVELS[level];
  const prefix = options?.prefix ?? "";
  let fileStream: fs.WriteStream | null = null;

  if (options?.logFile) {
    fileStream = fs.createWriteStream(options.logFile, { flags: "a" });
    fileStream.write(`\n--- Log started: ${new Date().toISOString()} ---\n`);
  }

  function write(logLevel: LogLevel, message: string): void {
    if (LOG_LEVELS[logLevel] < minLevel) return;

    const timestamp = new Date().toISOString().slice(11, 19);
    const color = LOG_COLORS[logLevel];
    const tag = logLevel.toUpperCase().padEnd(7);
    const pfx = prefix ? `[${prefix}] ` : "";

    // Console with colors
    console.log(`${color}${timestamp} ${tag}${RESET} ${pfx}${message}`);

    // File without colors
    if (fileStream) {
      fileStream.write(`${timestamp} ${tag} ${pfx}${message}\n`);
    }
  }

  return {
    info: (msg) => write("info", msg),
    warn: (msg) => write("warn", msg),
    error: (msg) => write("error", msg),
    debug: (msg) => write("debug", msg),
    verbose: (msg) => write("verbose", msg),
    close() {
      if (fileStream) {
        fileStream.end();
        fileStream = null;
      }
    },
  };
}
