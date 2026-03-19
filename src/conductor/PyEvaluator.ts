import { createBackend } from "../backend/config";
import type { BackendType } from "../backend/config";
import { parse } from "../parser/parser-adapter";
import { analyze, FunctionEnvironments } from "../resolver";
import { BasicEvaluator } from "@sourceacademy/conductor/runner";
import type { Backend } from "../backend/backend";
import { StmtNS } from "../ast-types";

declare const __BACKEND__: string;
declare const __JIT__: boolean;

export default class PyEvaluator extends BasicEvaluator {
  private lastSource: string | null = null;
  private lastAST: StmtNS.FileInput | null = null;
  private backend: Backend = createBackend({
    backend: (typeof __BACKEND__ !== "undefined" ? __BACKEND__ : "svml") as BackendType,
    jit: typeof __JIT__ !== "undefined" ? __JIT__ : true,
  });

  async evaluateChunk(chunk: string): Promise<void> {
    try {
      if (chunk !== this.lastSource) {
        const script = chunk + "\n";
        this.lastAST = parse(script);
        analyze(this.lastAST, script, 4);
        this.lastSource = chunk;
      }

      const ast = this.lastAST!;
      const emptyEnvs = new Map() as FunctionEnvironments;
      const result = await this.backend.run(ast, emptyEnvs);

      if (result.stdout) {
        this.conductor.sendOutput(result.stdout);
      }
      if (result.stderr) {
        this.conductor.sendOutput(result.stderr);
      }
      if (result.error) {
        this.conductor.sendOutput(`Error: ${result.error.message}`);
      }
    } catch (error) {
      this.conductor.sendOutput(
        `Error: ${error instanceof Error ? error.message : error}`
      );
    }
  }
}
