// This file is adapted from:
// https://github.com/source-academy/conductor
// Original author(s): Source Academy Team

import { BasicEvaluator, IRunnerPlugin } from "@sourceacademy/conductor/runner";
import { compileToWasmAndRun } from "../wasm-compiler";

// Wasm-backed evaluator. For SVML/CSE evaluation use PyEvaluator from ./PyEvaluator.ts.
export default class PyWasmEvaluator extends BasicEvaluator {
  constructor(conductor: IRunnerPlugin) {
    super(conductor);
  }

  async evaluateChunk(chunk: string): Promise<void> {
    try {
      const result = await compileToWasmAndRun(chunk);
      this.conductor.sendOutput(result.toString());
    } catch (error) {
      this.conductor.sendOutput(`Error: ${error instanceof Error ? error.message : error}`);
    }
  }
}
