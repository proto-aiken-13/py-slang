import { SVMLCompiler } from "../vm/svml-compiler"
import { parse } from "../parser/parser-adapter"
import { analyze, FunctionEnvironments } from "../resolver"
import { SVMLInterpreter } from "../vm/svml-interpreter"
import { SVMLBoxType, SVMLProgram } from "../vm/types"
import { InstrumentationTracker } from "../vm/instrumentation"

export interface IOptions {
    isPrelude: boolean,
    envSteps: number,
    stepLimit: number
};

function parsePythonToAst(code: string, chapter: number = 4, doValidate: boolean = false): any {
    const script = code + '\n'
    const ast = parse(script)
    if (doValidate) {
        analyze(ast, script, chapter);
    }
    return ast
}

export function compileCode(code: string, chapter: number = 4): { program: SVMLProgram, instrumentation: InstrumentationTracker, compiler: SVMLCompiler } {
    const pyAst = parsePythonToAst(code, chapter, true);
    const compiler = SVMLCompiler.fromProgram(pyAst);
    const program = compiler.compileProgram(pyAst);
    return { program, instrumentation: compiler.getInstrumentation(), compiler };
}

export async function runInContext(
    code: string
): Promise<{result: SVMLBoxType, stdout: string}> {
    const { program, instrumentation, compiler } = compileCode(code);
    const interpreter = new SVMLInterpreter(program, instrumentation, compiler);
    const result = interpreter.execute();
    return Promise.resolve({result, stdout: interpreter.getStdout()});
}

import { SVMLBackend } from "../vm/svml-backend";
import type { ComputationalResult } from "../types/result";

const backend = new SVMLBackend();

export async function runWithBackend(code: string): Promise<ComputationalResult> {
    const pyAst = parsePythonToAst(code, 4, true);
    const emptyEnvs = new Map() as FunctionEnvironments;
    return backend.run(pyAst, emptyEnvs);
}
