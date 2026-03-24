import assert from "assert";
import wabt from "wabt";
import { parse } from "../../parser";
import { StmtNS } from "../../ast-types";
import { BuilderGenerator } from "./builderGenerator";
import { ERROR_MAP } from "./constants";
import { WatGenerator } from "@sourceacademy/wasm-util";
import type { AbstractValue } from "../../types/abstract-value";
import { BackwardsBindings } from "../backwards-bindings";

// Module-level WABT singleton — loaded once, reused across all compilations.
let _wabt: Awaited<ReturnType<typeof wabt>> | null = null;

async function getWabt(): Promise<Awaited<ReturnType<typeof wabt>>> {
  if (!_wabt) _wabt = await wabt();
  return _wabt;
}

export async function compileToWasmAndRun(code: string) {
  const script = code + "\n";
  const ast = parse(script);

  const builderGenerator = new BuilderGenerator();
  const watIR = builderGenerator.visit(ast);

  const watGenerator = new WatGenerator();
  const wat = watGenerator.visit(watIR);

  const w = await getWabt();
  const wasm = w.parseWat("a", wat).toBinary({}).buffer as BufferSource;

  const memory = new WebAssembly.Memory({ initial: 1 });

  const result = await WebAssembly.instantiate(wasm, {
    console: {
      log: console.log,
      log_complex: (real: number, imag: number) =>
        console.log(`${real} ${imag >= 0 ? "+" : "-"} ${Math.abs(imag)}j`),
      log_bool: (value: bigint) => console.log(value === BigInt(0) ? "False" : "True"),
      log_string: (offset: number, length: number) =>
        console.log(new TextDecoder("utf8").decode(new Uint8Array(memory.buffer, offset, length))),
      log_closure: (tag: number, arity: number, envSize: number, parentEnv: number) =>
        console.log(
          `Closure (tag: ${tag}, arity: ${arity}, envSize: ${envSize}, parentEnv: ${parentEnv})`,
        ),
      log_none: () => console.log("None"),
      log_error: (tag: number) =>
        console.error(Object.values(ERROR_MAP).find(([i]) => i === tag)?.[1]),
      log_pair: () => console.log(),
    },
    js: { memory },
  });

  // run the exported main function
  assert(typeof result.instance.exports.main === "function");
  return result.instance.exports.main() as [number, number];
}

export interface WasmConsoleImports {
  log: (...args: unknown[]) => void;
  log_bool: (value: bigint) => void;
  log_string: (offset: number, length: number) => void;
  log_closure: (tag: number, arity: number, envSize: number, parentEnv: number) => void;
  log_none: () => void;
  log_complex: (real: number, imag: number) => void;
  log_error: (tag: number) => void;
  log_pair: () => void;
}

/** Compile an AST to a WebAssembly.Module (cacheable). */
export async function buildWasmModule(
  ast: StmtNS.FileInput,
  optionsOrAnnotations?:
    | WeakMap<object, AbstractValue>
    | { typeAnnotations?: WeakMap<object, AbstractValue>; profiling?: boolean },
): Promise<{
  module: WebAssembly.Module;
  bindings: BackwardsBindings<number> | null;
  funcArities: number[];
  numUserFunctions: number;
}> {
  // The instanceof guard already handles the WeakMap branch, so the cast below is safe.
  const opts =
    optionsOrAnnotations instanceof WeakMap
      ? { typeAnnotations: optionsOrAnnotations, profiling: false }
      : (optionsOrAnnotations ?? {});
  const { typeAnnotations, profiling = false } = opts as {
    typeAnnotations?: WeakMap<object, AbstractValue>;
    profiling?: boolean;
  };

  const bindings = profiling ? new BackwardsBindings<number>() : null;
  const builderGenerator = new BuilderGenerator();
  if (typeAnnotations) builderGenerator.withAnnotations(typeAnnotations);
  if (bindings) builderGenerator.withProfiling(bindings);

  const watIR = builderGenerator.visit(ast);
  const funcArities = builderGenerator.getFuncArities();
  const numUserFunctions = funcArities.length;

  const watGenerator = new WatGenerator();
  const wat = watGenerator.visit(watIR);

  const w = await getWabt();
  const wasm = w.parseWat("a", wat).toBinary({}).buffer as BufferSource;
  const module = await WebAssembly.compile(wasm);

  return { module, bindings, funcArities, numUserFunctions };
}

/** Instantiate and execute a pre-compiled WebAssembly.Module. */
export async function runWasmModule(
  module: WebAssembly.Module,
  memory: WebAssembly.Memory,
  consoleImports: WasmConsoleImports,
): Promise<{ tag: number; payload: bigint; instance: WebAssembly.Instance }> {
  const instance = await WebAssembly.instantiate(module, {
    console: consoleImports as unknown as WebAssembly.ModuleImports,
    js: { memory },
  });

  const mainFn = instance.exports.main;
  if (typeof mainFn !== "function") throw new Error("wasm module missing main export");

  // $main returns (i32 tag, i64 payload) when the program has a final expression.
  // When the program has no undropped instruction (all print() calls, assignments, etc.),
  // $main returns [] — tag defaults to -1, which WasmAdapter maps to { tag: "none" }.
  const ret = mainFn() as [number, bigint] | [];
  const tag = (ret as [number, bigint])[0] ?? -1;
  const payload = (ret as [number, bigint])[1] ?? 0n;
  return { tag, payload, instance };
}

/**
 * Compile and run in one shot (backward-compatible).
 * Prefer buildWasmModule + runWasmModule separately when caching is needed.
 */
export async function compileFromAST(
  ast: StmtNS.FileInput,
  memory: WebAssembly.Memory,
  consoleImports: WasmConsoleImports,
  typeAnnotations?: WeakMap<object, AbstractValue>,
): Promise<{ tag: number; payload: bigint }> {
  const { module } = await buildWasmModule(ast, typeAnnotations);
  return runWasmModule(module, memory, consoleImports);
}
