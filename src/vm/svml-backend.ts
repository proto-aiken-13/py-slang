import type { Backend } from "../backend/backend";
import { StmtNS } from "../ast-types";
import type { FunctionEnvironments } from "../resolver";
import type { ComputationalResult } from "../types/result";
import { SVMLCompiler } from "./svml-compiler";
import { SVMLInterpreter } from "./svml-interpreter";
import { SVMLAdapter } from "./svml-adapter";
import type { SVMLProgram } from "./types";
import type { InstrumentationTracker } from "./instrumentation";
import type { TypeInformation } from "../specialization/types";
import type { BackwardsBindings } from "../backend/backwards-bindings";

export interface SVMLBackendOptions {
  jit?: boolean;
}

interface CachedProgram {
  program: SVMLProgram;
  compiler: SVMLCompiler;
  instrumentation: InstrumentationTracker;
  bindings: BackwardsBindings<number>;
}

export class SVMLBackend implements Backend {
  private adapter = new SVMLAdapter();
  private jit: boolean;

  // Compilation cache: skip resolve+compile when same AST is reused
  private lastAST: StmtNS.FileInput | null = null;
  private cached: CachedProgram | null = null;

  // Held after run() to expose type observations via collectTypeInfo().
  private lastInterpreter: SVMLInterpreter | null = null;

  constructor(options?: SVMLBackendOptions) {
    this.jit = options?.jit ?? true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(
    ast: StmtNS.FileInput,
    _environments: FunctionEnvironments,
  ): Promise<ComputationalResult> {
    try {
      if (ast !== this.lastAST || !this.cached) {
        const compiler = SVMLCompiler.fromProgram(ast);
        const program = compiler.compileProgram(ast);
        const bindings = compiler.getBindings();
        this.cached = {
          program,
          compiler,
          instrumentation: compiler.getInstrumentation(),
          bindings,
        };
        this.lastAST = ast;
      }

      const { program, compiler, instrumentation } = this.cached;
      const interpreter = new SVMLInterpreter(
        program,
        instrumentation,
        this.jit ? compiler : undefined,
      );
      const native = interpreter.execute();
      this.lastInterpreter = interpreter;

      return {
        value: this.adapter.toPython(native),
        stdout: interpreter.getStdout(),
        stderr: "",
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        value: { tag: "none" },
        stdout: "",
        stderr: "",
        error: { kind: "value_error", message },
      };
    }
  }

  collectTypeInfo(): TypeInformation {
    if (!this.lastInterpreter || !this.cached) return new Map();
    return this.cached.bindings.resolve(this.lastInterpreter.getTypeObservations());
  }
}
