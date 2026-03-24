import type { Backend } from "../types";
import type { StmtNS } from "../../ast-types";
import type { FunctionEnvironments } from "../../resolver";
import type { ComputationalResult } from "../../types/result";
import type { PythonType } from "../../types/python-type";
import type { Value } from "../cse/stash";
import { SVMLCompiler } from "./svml-compiler";
import { assemble } from "./svml-assembler";

/**
 * Sinter backend. Compiles Python AST to SVML bytecode, assembles it
 * into a binary, and executes it via the sinter C/WASM VM.
 *
 * This is a sub-backend of the SVML pipeline — it shares the compiler
 * and assembler but swaps the TypeScript interpreter for the native
 * sinter runtime.
 */
export class SinterBackend implements Backend {
  async run(
    ast: StmtNS.FileInput,
    _environments: FunctionEnvironments,
  ): Promise<ComputationalResult> {
    try {
      const compiler = SVMLCompiler.fromProgram(ast);
      const program = compiler.compileProgram(ast);
      const binary = assemble(program);
      const { default: initSinter } = await import("./sinter/sinter");
      const sinter = await initSinter();
      const result = sinter.runBinary(binary);
      return {
        value: sinterValueToPython(result),
        stdout: "",
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
}

/** Convert sinter's CSE-style Value to PythonType. */
function sinterValueToPython(v: Value): PythonType {
  switch (v.type) {
    case "int":
      return { tag: "int", value: v.value as number };
    case "float":
      return { tag: "float", value: v.value as number };
    case "bool":
      return { tag: "bool", value: v.value as boolean };
    case "string":
      return { tag: "str", value: v.value as string };
    case "NoneType":
    case "undefined":
      return { tag: "none" };
    default:
      return { tag: "none" };
  }
}
