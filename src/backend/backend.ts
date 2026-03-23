import type { StmtNS } from "../ast-types";
import type { FunctionEnvironments } from "../resolver";
import type { ComputationalResult } from "../types/result";
import type { TypeInformation } from "../specialization/types";

export interface Backend {
  run(ast: StmtNS.FileInput, environments: FunctionEnvironments): Promise<ComputationalResult>;

  /**
   * Returns type profiles observed during the most recent run(), or undefined
   * if this backend does not support profiling.
   * Call after run() completes; undefined before the first run.
   */
  collectTypeInfo?(): TypeInformation;
}
