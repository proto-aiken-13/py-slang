#!/usr/bin/env tsx
import { execSync } from "child_process";
import { Command } from "commander";
import { select, confirm } from "@inquirer/prompts";

const BACKENDS = [
  { name: "svml     - SVML bytecode VM", value: "svml" },
  { name: "cse      - CSE machine", value: "cse" },
  { name: "wasm     - WebAssembly backend", value: "wasm" },
  { name: "wasm-jit - WebAssembly with JIT", value: "wasm-jit" },
] as const;

type BackendChoice = (typeof BACKENDS)[number]["value"];

interface BuildOptions {
  backend: BackendChoice;
  jit: boolean;
}

async function promptOptions(): Promise<BuildOptions> {
  const backend = await select({
    message: "Select backend:",
    choices: [...BACKENDS],
    default: "svml",
  });

  const jit = await confirm({
    message: "Enable JIT specialization?",
    default: true,
  });

  return { backend: backend as BackendChoice, jit };
}

function parseFlags(): BuildOptions | null {
  const program = new Command()
    .option("--backend <type>", "Backend engine: svml, cse, wasm, wasm-jit", "svml")
    .option("--jit", "Enable JIT specialization (default)")
    .option("--no-jit", "Disable JIT specialization")
    .parse();

  const opts = program.opts();

  // If user explicitly passed flags, use them
  if (process.argv.length > 2) {
    const backend = opts.backend as string;
    const validBackends = BACKENDS.map((b) => b.value) as readonly string[];
    if (!validBackends.includes(backend)) {
      console.error(
        `Invalid backend: ${backend}. Expected one of: ${validBackends.join(", ")}`,
      );
      process.exit(1);
    }
    return { backend: backend as BackendChoice, jit: opts.jit ?? true };
  }

  return null; // No flags → prompt interactively
}

async function main() {
  const flagOptions = parseFlags();
  const options = flagOptions ?? (await promptOptions());

  console.log(`\nBuilding with backend=${options.backend}, jit=${options.jit}...\n`);

  const env = {
    ...process.env,
    BACKEND: options.backend,
    JIT: options.jit ? "on" : "off",
  };

  try {
    execSync("rollup -c --bundleConfigAsCjs", {
      env,
      stdio: "inherit",
      cwd: process.cwd(),
    });
  } catch {
    process.exit(1);
  }
}

main();
