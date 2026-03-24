import type { Backend } from "../types";
import type { StmtNS } from "../../ast-types";
import type { FunctionEnvironments } from "../../resolver";
import type { ComputationalResult } from "../../types/result";
import { Context } from "./context";
import { evaluate } from "./interpreter";
import { CSEAdapter } from "./cse-adapter";

export class CSEBackend implements Backend {
  private adapter = new CSEAdapter();

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(
    ast: StmtNS.FileInput,
    _environments: FunctionEnvironments,
  ): Promise<ComputationalResult> {
    const context = new Context();
    try {
      const result = evaluate("", ast, context);

      if (result.type === "error") {
        return {
          value: { tag: "none" },
          stdout: context.output,
          stderr: "",
          error: { kind: "value_error", message: result.message },
        };
      }

      // evaluate() returns the accumulated output as a StringValue when
      // there is print output, replacing the actual program result.
      // Detect this and use context.output for stdout instead.
      const hasOutput = context.output.length > 0;
      const value =
        hasOutput && result.type === "string"
          ? { tag: "none" as const }
          : this.adapter.toPython(result);

      return {
        value,
        stdout: context.output,
        stderr: "",
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        value: { tag: "none" },
        stdout: context.output,
        stderr: "",
        error: { kind: "value_error", message },
      };
    }
  }
}
