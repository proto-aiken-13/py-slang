#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import { parse } from "../parser/parser-adapter";
import { analyze } from "../resolver";
import { StmtNS } from "../ast-types";
import { SVMLBackend } from "../vm/svml-backend";
import { WasmBackend } from "../wasm-compiler/wasm-backend";
import { WasmJITBackend } from "../wasm-compiler/wasm-jit-backend";
import type { Backend } from "../backend/backend";
import type { FunctionEnvironments } from "../resolver";

interface BenchResult {
  backend: string;
  jit: boolean;
  runs: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

async function benchmark(
  name: string,
  backend: Backend,
  ast: StmtNS.FileInput,
  runs: number,
): Promise<BenchResult> {
  const emptyEnvs = new Map() as FunctionEnvironments;
  const times: number[] = [];

  // Warmup run
  await backend.run(ast, emptyEnvs);

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await backend.run(ast, emptyEnvs);
    times.push(performance.now() - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  return {
    backend: name,
    jit: name.includes("jit"),
    runs,
    totalMs: Math.round(totalMs * 100) / 100,
    avgMs: Math.round((totalMs / runs) * 100) / 100,
    minMs: Math.round(Math.min(...times) * 100) / 100,
    maxMs: Math.round(Math.max(...times) * 100) / 100,
  };
}

/** Benchmark wasm-cold: new WasmBackend per run forces full recompilation every time. */
async function benchmarkWasmCold(
  ast: StmtNS.FileInput,
  runs: number,
): Promise<BenchResult> {
  const emptyEnvs = new Map() as FunctionEnvironments;
  const times: number[] = [];

  // Warmup (pays WABT singleton init)
  await new WasmBackend().run(ast, emptyEnvs);

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await new WasmBackend().run(ast, emptyEnvs);
    times.push(performance.now() - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  return {
    backend: "wasm-cold",
    jit: false,
    runs,
    totalMs: Math.round(totalMs * 100) / 100,
    avgMs: Math.round((totalMs / runs) * 100) / 100,
    minMs: Math.round(Math.min(...times) * 100) / 100,
    maxMs: Math.round(Math.max(...times) * 100) / 100,
  };
}

function main() {
  const program = new Command();

  program
    .name("bench")
    .description("Benchmark py-slang backends")
    .argument("<input-file>", "Python file to benchmark")
    .option("-n, --runs <number>", "Number of runs per backend", "10")
    .option("--backends <list>", "Comma-separated backends to test", "svml-jit,svml-nojit,wasm,wasm-jit")
    .action(async (inputFile: string, opts: { runs: string; backends: string }) => {
      if (!fs.existsSync(inputFile)) {
        console.error(`Error: File '${inputFile}' not found`);
        process.exit(1);
      }

      const code = fs.readFileSync(inputFile, "utf8");
      const runs = parseInt(opts.runs, 10);
      if (isNaN(runs) || runs < 1) {
        console.error(`Error: --runs must be a positive integer (got '${opts.runs}')`);
        process.exit(1);
      }
      const backendNames = opts.backends.split(",").map(s => s.trim());

      // Parse once (shared across backends)
      const script = code + "\n";
      const ast = parse(script) as StmtNS.FileInput;
      analyze(ast, script, 4);
      const emptyEnvs = new Map() as FunctionEnvironments;

      console.log(`\nBenchmarking: ${inputFile}`);
      console.log(`Runs per backend: ${runs}\n`);

      const results: BenchResult[] = [];

      for (const name of backendNames) {
        // wasm-cold forces a fresh WasmBackend per run to measure raw compilation cost.
        if (name === "wasm-cold") {
          process.stdout.write(`  ${name}: running...`);
          const result = await benchmarkWasmCold(ast, runs);
          results.push(result);
          process.stdout.write(`\r  ${name}: ${result.avgMs}ms avg (${result.minMs}-${result.maxMs}ms range)\n`);
          continue;
        }

        let backend: Backend;
        switch (name) {
          case "svml-jit":
            backend = new SVMLBackend({ jit: true });
            break;
          case "svml-nojit":
            backend = new SVMLBackend({ jit: false });
            break;
          case "wasm":
            // Reused WasmBackend: warmup run pays compilation, measured runs are execution-only.
            backend = new WasmBackend();
            break;
          case "wasm-jit":
            backend = new WasmJITBackend();
            break;
          default:
            console.log(`  ${name}: skipped (not implemented)`);
            continue;
        }

        process.stdout.write(`  ${name}: running...`);
        const result = await benchmark(name, backend, ast, runs);
        results.push(result);
        process.stdout.write(`\r  ${name}: ${result.avgMs}ms avg (${result.minMs}-${result.maxMs}ms range)\n`);
      }

      if (results.length === 0) return;

      // Summary table
      console.log("\n--- Summary ---");
      console.log("Backend       | Avg (ms) | Min (ms) | Max (ms) | Runs");
      console.log("------------- | -------- | -------- | -------- | ----");
      for (const r of results) {
        const name = r.backend.padEnd(13);
        console.log(`${name} | ${String(r.avgMs).padStart(8)} | ${String(r.minMs).padStart(8)} | ${String(r.maxMs).padStart(8)} | ${r.runs}`);
      }

      if (results.length >= 2) {
        const fastest = results.reduce((a, b) => a.avgMs < b.avgMs ? a : b);
        const slowest = results.reduce((a, b) => a.avgMs > b.avgMs ? a : b);
        const speedup = Math.round((slowest.avgMs / fastest.avgMs) * 100) / 100;
        console.log(`\n${fastest.backend} is ${speedup}x faster than ${slowest.backend}`);
      }
    });

  program.parse(process.argv);
}

main();
