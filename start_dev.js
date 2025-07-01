#!/usr/bin/env node

/**
 * Development Startup Script for BeaCompanion
 * Launches both frontend and backend servers
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.info("🚀 Starting BeaCompanion Development Environment\n");

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.info(`${colors[color]}${message}${colors.reset}`);
}

// Start backend server
log("📡 Starting Backend Server...", "blue");
const backend = spawn("npm", ["start"], {
  cwd: join(__dirname, "server"),
  stdio: "pipe",
  shell: true,
});

backend.stdout.on("data", (data) => {
  log(`[Backend] ${data.toString().trim()}`, "green");
});

backend.stderr.on("data", (data) => {
  log(`[Backend Error] ${data.toString().trim()}`, "red");
});

backend.on("error", (error) => {
  log(`[Backend] Failed to start: ${error.message}`, "red");
});

// Wait a bit for backend to start, then start frontend
setTimeout(() => {
  log("🌐 Starting Frontend Server...", "blue");
  const frontend = spawn("npm", ["run", "dev"], {
    cwd: join(__dirname, "client"),
    stdio: "pipe",
    shell: true,
  });

  frontend.stdout.on("data", (data) => {
    const output = data.toString().trim();
    if (output.includes("Local:")) {
      log(`[Frontend] ${output}`, "green");
      log("\n BeaCompanion is ready!", "bright");
      log("Frontend: http://localhost:5173", "cyan");
      log("Backend: http://localhost:4000", "cyan");
      log("\nPress Ctrl+C to stop all servers\n", "yellow");
    } else {
      log(`[Frontend] ${output}`, "green");
    }
  });

  frontend.stderr.on("data", (data) => {
    log(`[Frontend Error] ${data.toString().trim()}`, "red");
  });

  frontend.on("error", (error) => {
    log(`[Frontend] Failed to start: ${error.message}`, "red");
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    log("\n Shutting down servers...", "yellow");
    backend.kill("SIGINT");
    frontend.kill("SIGINT");
    process.exit(0);
  });
}, 2000);

// Handle backend startup errors
backend.on("exit", (code) => {
  if (code !== 0) {
    log(`[Backend] Server exited with code ${code}`, "red");
    process.exit(1);
  }
});
