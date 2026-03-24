#!/usr/bin/env node
/**
 * jit-diff — show what the JIT specialization pass changes in the emitted IR.
 *
 * Usage:
 *   npm run jit-diff -- <file.py>
 *   npm run jit-diff -- --backend svml <file.py>
 *   echo "def f(x): return x+1\nf(1)" | npm run jit-diff
 *
 * Backends:
 *   wasm (default) — diffs the WAT (WebAssembly Text) output.
 *                    Highlights $_fast_int_add/sub/mul/div promotions.
 *   svml           — diffs the SVML bytecode instruction stream.
 *                    Highlights ADDG→ADDF, LDLG→LDLF, etc. specializations.
 */

// __DEBUG__ is injected by rollup in production builds; define it for tsx/ts-node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__DEBUG__ = false;

import { Command } from "commander";
import * as fs from "fs";
import { parse } from "../parser/parser-adapter";
import { SVMLBackend } from "../vm/svml-backend";
import { SVMLCompiler } from "../vm/svml-compiler";
import { specialize } from "../specialization/enrich";
import { BuilderGenerator } from "../wasm-compiler/builderGenerator";
import { WatGenerator } from "@sourceacademy/wasm-util";
import OpCodes from "../vm/opcodes";
import type { StmtNS } from "../ast-types";
import type { SVMLProgram } from "../vm/types";
import { EnrichedFileInput } from "../specialization/enrich";

// ── ANSI colours ──────────────────────────────────────────────────────────────

const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── WAT generation ────────────────────────────────────────────────────────────

/**
 * Split compact WAT into a map of function-name → body string.
 * We use this to diff at the function level: only show functions that changed.
 */
function extractFunctions(wat: string): Map<string, string> {
  const funcs = new Map<string, string>();
  // Each top-level (func $name ...) in the compact WAT starts with "(func $"
  const re = /\(func (\$[\w]+)/g;
  let match: RegExpExecArray | null;
  const starts: Array<{ name: string; pos: number }> = [];

  while ((match = re.exec(wat)) !== null) {
    starts.push({ name: match[1], pos: match.index });
  }

  for (let i = 0; i < starts.length; i++) {
    const { name, pos } = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].pos : wat.length;
    // Trim the trailing space/paren that belongs to the module wrapper
    let body = wat.slice(pos, end).trimEnd();
    // Drop any trailing ") " or ")" that's the module close
    if (body.endsWith(")") && countParens(body) < 0) body = body.slice(0, -1).trimEnd();
    funcs.set(name, body);
  }
  return funcs;
}

function countParens(s: string): number {
  let n = 0;
  for (const c of s) {
    if (c === "(") n++;
    else if (c === ")") n--;
  }
  return n;
}

/**
 * Pretty-print a single function body: one token per line, indented by depth.
 * Only applied to changed functions so indentation is consistent within a hunk.
 */
function prettyFunc(body: string): string {
  const tokens = body.match(/[()]|[^() ]+/g) ?? [];
  const lines: string[] = [];
  let depth = 0;
  let line = "";

  for (const tok of tokens) {
    if (tok === "(") {
      if (line.trim()) {
        lines.push("  ".repeat(depth) + line.trim());
        line = "";
      }
      line = "(";
      depth++;
    } else if (tok === ")") {
      depth = Math.max(0, depth - 1);
      if (line.trim() && line.trim() !== "(") {
        lines.push("  ".repeat(depth) + line.trim() + ")");
        line = "";
      } else {
        line = (line + ")").trim();
      }
    } else {
      line += (line.endsWith("(") ? "" : " ") + tok;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

/** Compile AST → compact WAT string (with named calls). */
function toCompactWat(
  ast: StmtNS.FileInput,
  annotations?: WeakMap<object, unknown>,
): Promise<string> {
  const gen = new BuilderGenerator();
  if (annotations)
    gen.withAnnotations(
      annotations as WeakMap<object, import("../types/abstract-value").AbstractValue>,
    );
  const ir = gen.visit(ast);
  return new WatGenerator().visit(ir);
}

// ── SVML IR formatting ────────────────────────────────────────────────────────

/** Reverse map: opcode number → name (e.g. 17 → "ADDG"). */
const OPCODE_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(OpCodes)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => [v as number, k]),
);

/** Opcodes that get specialized by JIT (generic → typed variant). */
const SVML_SPECIALIZED_RE =
  /\b(ADD|SUB|MUL|DIV|MOD|LT|GT|LE|GE|EQ|NEQ|NOT|NEG|POP|LDL|STL|LDP|STP|LDA|STA|RET)F\b/;

/**
 * Format an SVMLProgram as a map of "fn<index>" → instruction listing.
 * Only user functions (those with AST nodes registered) are included.
 */
function formatSvmlFunctions(program: SVMLProgram): Map<string, string> {
  const result = new Map<string, string>();
  for (let fi = 0; fi < program.functions.length; fi++) {
    const ir = program.functions[fi];
    const lines: string[] = [];
    for (let i = 0; i < ir.count; i++) {
      const op = ir.opcodes[i];
      const name = OPCODE_NAMES.get(op) ?? `OP_${op}`;
      const a1 = ir.arg1s[i];
      const a2 = ir.arg2s[i];
      // Only show args that are non-zero (avoids clutter for zero-arg instructions)
      if (a1 !== 0 || a2 !== 0) {
        lines.push(`  ${name} ${a1}${a2 !== 0 ? ` ${a2}` : ""}`);
      } else {
        lines.push(`  ${name}`);
      }
    }
    result.set(`fn${fi}`, lines.join("\n"));
  }
  return result;
}

/** Compile AST → SVMLProgram, honoring type annotations when present. */
function toSvmlProgram(ast: StmtNS.FileInput): SVMLProgram {
  const compiler = SVMLCompiler.fromProgram(ast);
  if (ast instanceof EnrichedFileInput) {
    compiler.setASTAnnotations(ast.typeAnnotations);
  }
  return compiler.compileProgram(ast);
}

// ── Function-level diff ───────────────────────────────────────────────────────

const FAST_INT_RE = /fast_int_(add|sub|mul|div|mod|eq|neq|lt|lte|gt|gte|neg)|fast_bool_not/;
const CONTEXT = 2;

/**
 * Diff two pretty-printed function bodies line by line.
 * highlightRe: lines matching this in the "add" side are bolded green.
 */
function diffFunc(
  name: string,
  before: string,
  after: string,
  highlightRe: RegExp,
): { changed: boolean; specializations: number } {
  const a = before.split("\n");
  const b = after.split("\n");

  const changes: Array<{ idx: number; kind: "del" | "add" }> = [];
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) changes.push({ idx: i, kind: "del" });
      if (b[i] !== undefined) changes.push({ idx: i, kind: "add" });
    }
  }

  if (changes.length === 0) return { changed: false, specializations: 0 };

  console.log(CYAN(`@@ ${name} @@`));

  const printed = new Set<string>();
  let lastEnd = -1;

  for (const { idx, kind } of changes) {
    const start = Math.max(0, idx - CONTEXT);
    const ctxEnd =
      kind === "del"
        ? Math.min(a.length - 1, idx + CONTEXT)
        : Math.min(b.length - 1, idx + CONTEXT);

    if (start > lastEnd + 1 && lastEnd >= 0) {
      console.log(CYAN("  ..."));
    }

    for (let i = start; i < idx; i++) {
      const key = `ctx:${i}`;
      if (!printed.has(key)) {
        console.log(`  ${a[i] ?? ""}`);
        printed.add(key);
      }
    }

    const key = `${kind}:${idx}`;
    if (!printed.has(key)) {
      if (kind === "del") {
        console.log(RED(`- ${a[idx] ?? ""}`));
      } else {
        const raw = b[idx] ?? "";
        const line = `+ ${raw}`;
        console.log(highlightRe.test(raw) ? BOLD(GREEN(line)) : GREEN(line));
      }
      printed.add(key);
    }

    const src = kind === "del" ? a : b;
    for (let i = idx + 1; i <= ctxEnd; i++) {
      const key = `ctx:${i}`;
      if (!printed.has(key)) {
        console.log(`  ${src[i] ?? ""}`);
        printed.add(key);
      }
    }

    lastEnd = ctxEnd;
  }

  const specializations = changes.filter(
    c => c.kind === "add" && highlightRe.test(b[c.idx] ?? ""),
  ).length;

  return { changed: true, specializations };
}

function diffFunctions(
  before: Map<string, string>,
  after: Map<string, string>,
  highlightRe: RegExp,
  pretty: (s: string) => string = s => s,
): void {
  const allNames = new Set([...before.keys(), ...after.keys()]);
  let totalChanged = 0;
  let totalSpecializations = 0;

  for (const name of allNames) {
    const bBefore = before.get(name) ?? "";
    const bAfter = after.get(name) ?? "";
    if (bBefore === bAfter) continue;

    const { changed, specializations } = diffFunc(
      name,
      bBefore ? pretty(bBefore) : "(not present)",
      bAfter ? pretty(bAfter) : "(not present)",
      highlightRe,
    );
    if (changed) {
      totalChanged++;
      totalSpecializations += specializations;
      console.log();
    }
  }

  if (totalChanged === 0) {
    console.log(YELLOW("No differences found — no specializations were applied."));
    console.log("This can happen when the function was not called or argument types");
    console.log("could not be determined (e.g. non-integer args).");
    return;
  }

  console.log(
    BOLD(
      `Summary: ${totalChanged} function(s) changed, ` +
        `${totalSpecializations} fast-int specialization(s) applied.`,
    ),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const program = new Command();
  program
    .name("jit-diff")
    .description("Diff IR output before and after JIT specialization")
    .argument("[file]", "Python source file (reads stdin if omitted)")
    .option("--full", "print full IR for both passes instead of a diff")
    .option("--backend <name>", "backend to diff: wasm (default) or svml", "wasm")
    .parse(process.argv);

  const [file] = program.args;
  const opts = program.opts<{ full: boolean; backend: string }>();

  if (opts.backend !== "wasm" && opts.backend !== "svml") {
    console.error(RED(`Unknown backend '${opts.backend}'. Valid options: wasm, svml`));
    process.exit(1);
  }

  const src = file ? fs.readFileSync(file, "utf-8") : fs.readFileSync("/dev/stdin", "utf-8");

  const ast = parse(src.endsWith("\n") ? src : src + "\n");
  const emptyEnvs = new Map() as import("../resolver").FunctionEnvironments;

  // Pass 1 — SVML profiling
  const svml = new SVMLBackend({ jit: true });
  const svmlResult = await svml.run(ast, emptyEnvs);
  if (svmlResult.error) {
    console.error(RED(`SVML profiling pass failed: ${svmlResult.error.message}`));
    if (svmlResult.stderr) console.error(svmlResult.stderr);
    process.exit(1);
  }
  const typeInfo = svml.collectTypeInfo();

  if (typeInfo.size === 0) {
    console.log(YELLOW("Profiling pass produced no type information."));
    console.log("Make sure the source calls at least one user-defined function.");
    process.exit(0);
  }

  // Build EnrichedFileInput
  const compiler = SVMLCompiler.fromProgram(ast);
  compiler.compileProgram(ast);
  const enriched = specialize(ast, typeInfo, fn => compiler.createSlotLookupForFunction(fn));

  if (opts.backend === "svml") {
    const beforeProg = toSvmlProgram(ast);
    const afterProg = toSvmlProgram(enriched);

    if (opts.full) {
      console.log(BOLD("=== BEFORE (generic SVML) ==="));
      for (const [name, body] of formatSvmlFunctions(beforeProg)) {
        console.log(CYAN(`fn ${name}:`));
        console.log(body);
      }
      console.log(BOLD("\n=== AFTER (JIT-specialized SVML) ==="));
      for (const [name, body] of formatSvmlFunctions(afterProg)) {
        console.log(CYAN(`fn ${name}:`));
        console.log(body);
      }
      return;
    }

    console.log(
      BOLD("JIT specialization diff") +
        "  " +
        CYAN(`(${file ?? "stdin"})`) +
        "  " +
        YELLOW("[svml]"),
    );
    console.log(RED("  - generic") + "   " + BOLD(GREEN("+ specialized (bold = typed op)")));
    console.log("─".repeat(60));
    diffFunctions(
      formatSvmlFunctions(beforeProg),
      formatSvmlFunctions(afterProg),
      SVML_SPECIALIZED_RE,
    );
    return;
  }

  // ── wasm backend (default) ─────────────────────────────────────────────────
  const beforeWat = await toCompactWat(ast);
  const afterWat = await toCompactWat(enriched, enriched.typeAnnotations);

  if (opts.full) {
    console.log(BOLD("=== BEFORE (generic) ==="));
    console.log(beforeWat);
    console.log(BOLD("\n=== AFTER (JIT-specialized) ==="));
    console.log(afterWat);
    return;
  }

  const beforeFuncs = extractFunctions(beforeWat);
  const afterFuncs = extractFunctions(afterWat);

  console.log(
    BOLD("JIT specialization diff") + "  " + CYAN(`(${file ?? "stdin"})`) + "  " + YELLOW("[wasm]"),
  );
  console.log(RED("  - generic") + "   " + BOLD(GREEN("+ specialized (bold = fast-int)")));
  console.log("─".repeat(60));
  diffFunctions(beforeFuncs, afterFuncs, FAST_INT_RE, prettyFunc);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
