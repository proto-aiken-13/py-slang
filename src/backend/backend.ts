import type { StmtNS } from "../ast-types";
import type { FunctionEnvironments } from "../resolver";
import type { ComputationalResult } from "../types/result";
import type { TypeInformation } from "../specialization/types";

/**
 * Contract for Python execution backends.
 * Compiles and executes a Python AST, returning value + stdout/stderr.
 */
export interface Backend {
  /**
   * Execute a Python AST and return the result.
   *
   * @param ast - Parsed Python program
   * @param environments - Function environment map from resolver.
   *   Currently unused by both backends; reserved for future environment-aware execution.
   */
  run(ast: StmtNS.FileInput, environments: FunctionEnvironments): Promise<ComputationalResult>;

  /**
   * Returns type profiles observed during the most recent run(), or undefined
   * if this backend does not support profiling.
   * Call after run() completes; undefined before the first run.
   */
  collectTypeInfo?(): TypeInformation;
}
