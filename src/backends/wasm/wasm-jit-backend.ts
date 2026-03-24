import type { Backend } from "../backend/backend";
import type { StmtNS } from "../ast-types";
import type { FunctionEnvironments } from "../resolver";
import type { TypeInformation } from "../specialization/types";
import { SVMLBackend } from "../vm/svml-backend";
import { SVMLCompiler } from "../vm/svml-compiler";
import { specialize } from "../specialization/enrich";
import { WasmBackend } from "./wasm-backend";

/**
 * Two-pass JIT backend: profiles with SVMLBackend(jit:true),
 * then runs the type-enriched AST through WasmBackend (with self-profiling).
 */
export class WasmJITBackend implements Backend {
  private readonly wasm = new WasmBackend({ profiling: true });
  private readonly svml = new SVMLBackend({ jit: true });

  async run(ast: StmtNS.FileInput, environments: FunctionEnvironments) {
    await this.svml.run(ast, environments);

    const typeInfo = this.svml.collectTypeInfo();
    const compiler = SVMLCompiler.fromProgram(ast);
    compiler.compileProgram(ast);
    const enriched = specialize(ast, typeInfo, fn => compiler.createSlotLookupForFunction(fn));

    return this.wasm.run(enriched, environments);
  }

  /**
   * Returns type profiles from the most recent execution.
   * Prefers Wasm self-profiling (AST node keys) when available;
   * falls back to SVML profiles otherwise.
   * Returns empty map before first run().
   */
  collectTypeInfo(): TypeInformation {
    const wasmInfo = this.wasm.collectTypeInfo();
    // Non-empty: at least one user function was called with a recognized type tag.
    // Empty: no user functions observed, or all observed types were COMPLEX/PAIR/UNBOUND
    // (unrepresentable in the lattice). In the latter case the SVML fallback may also
    // be empty, since it saw the same unrepresentable arguments.
    if (wasmInfo.size > 0) return wasmInfo;
    return this.svml.collectTypeInfo();
  }
}
