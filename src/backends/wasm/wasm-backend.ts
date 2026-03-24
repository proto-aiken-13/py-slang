import type { Backend } from "../backend/backend";
import type { StmtNS } from "../ast-types";
import type { FunctionEnvironments } from "../resolver";
import type { ComputationalResult } from "../types/result";
import { buildWasmModule, runWasmModule, type WasmConsoleImports } from "./index";
import { WasmAdapter } from "./wasm-adapter";
import { ERROR_MAP } from "./constants";
import { EnrichedFileInput } from "../specialization/enrich";
import type { BackwardsBindings } from "../backend/backwards-bindings";
import { decodeObservations, MAX_PARAMS_TRACKED } from "./wasm-profiling";
import type { TypeInformation } from "../specialization/types";

export class WasmBackend implements Backend {
  private adapter = new WasmAdapter();

  // Compilation cache: skip AST → WebAssembly.Module when same AST is reused.
  private lastAST: StmtNS.FileInput | null = null;
  private cachedModule: WebAssembly.Module | null = null;
  // Used to decode the profiling observation buffer post-execution.
  private cachedFuncArities: number[] = [];
  private cachedBindings: BackwardsBindings<number> | null = null;
  private cachedNumUserFunctions = 0;
  private lastTypeInfo: TypeInformation | null = null;

  constructor(private readonly options?: { profiling?: boolean }) {}

  async run(
    ast: StmtNS.FileInput,
    _environments: FunctionEnvironments,
  ): Promise<ComputationalResult> {
    const stdout: string[] = [];
    const errors: string[] = [];

    // Memory is created before instantiation so log_string can close over it.
    // The closures in consoleImports capture `memory` by reference at construction
    // time, ensuring strings are readable during main() execution.
    const memory = new WebAssembly.Memory({ initial: 1 });

    const decodeString = (offset: number, length: number) =>
      new TextDecoder("utf-8").decode(new Uint8Array(memory.buffer, offset, length));

    const consoleImports: WasmConsoleImports = {
      log: (...args) => stdout.push(String(args[0])),
      log_bool: value => stdout.push(value === 0n ? "False" : "True"),
      log_string: (offset, length) => stdout.push(decodeString(offset, length)),
      log_complex: (real, imag) =>
        stdout.push(`${real} ${imag >= 0 ? "+" : "-"} ${Math.abs(imag)}j`),
      log_none: () => stdout.push("None"),
      log_closure: (tag, arity, envSize, parentEnv) =>
        stdout.push(
          `Closure (tag: ${tag}, arity: ${arity}, envSize: ${envSize}, parentEnv: ${parentEnv})`,
        ),
      log_pair: () => stdout.push("Pair"),
      log_error: tag => {
        // Wasm runtime errors go to stderr. Note: log_error is always followed by
        // wasm `unreachable`, so a WebAssembly.RuntimeError will also be caught
        // below and appended to stderr. Both messages will appear in stderr.
        const entry = Object.values(ERROR_MAP).find(([i]) => i === tag);
        errors.push(entry?.[1] ?? `wasm runtime error (tag ${tag})`);
      },
    };

    // Reset so collectTypeInfo() never returns stale data from a previous run.
    this.lastTypeInfo = null;

    try {
      // Compile only when the AST object changes.
      if (ast !== this.lastAST || !this.cachedModule) {
        const result = await buildWasmModule(ast, {
          typeAnnotations: ast instanceof EnrichedFileInput ? ast.typeAnnotations : undefined,
          profiling: this.options?.profiling ?? false,
        });
        this.cachedModule = result.module;
        this.cachedFuncArities = result.funcArities;
        this.cachedBindings = result.bindings;
        this.cachedNumUserFunctions = result.numUserFunctions;
        this.lastAST = ast;
      }

      const { tag, payload, instance } = await runWasmModule(
        this.cachedModule,
        memory,
        consoleImports,
      );

      // Decode profiling observations if profiling is enabled
      if (this.options?.profiling && this.cachedBindings) {
        const profilingBaseGlobal = instance.exports.profiling_base as
          | WebAssembly.Global
          | undefined;
        if (profilingBaseGlobal) {
          const profilingBase = profilingBaseGlobal.value as number;
          const rawObs = decodeObservations(
            memory,
            profilingBase,
            this.cachedNumUserFunctions,
            this.cachedFuncArities,
            MAX_PARAMS_TRACKED,
          );
          this.lastTypeInfo = this.cachedBindings.resolve(rawObs);
        }
      }

      const value = this.adapter.toPython({ tag, payload, memory });
      return {
        value,
        stdout: stdout.join("\n"),
        stderr: errors.join("\n"),
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        value: { tag: "none" },
        stdout: stdout.join("\n"),
        // errors[] may already contain a log_error message from the wasm runtime.
        // The JS exception message (e.g. "RuntimeError: unreachable") is appended after.
        stderr: [...errors, message].join("\n"),
        error: { kind: "type_error", message },
      };
    }
  }

  collectTypeInfo(): TypeInformation {
    return this.lastTypeInfo ?? new Map();
  }
}
