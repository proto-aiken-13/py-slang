#!/usr/bin/env node

import { Command } from "commander";
import { SVMLCompiler } from "../backends/svml";
import { SVMLProgram } from "../backends/svml/types";
import { disassemble } from "../backends/svml/svml-assembler";
import { SVMLInterpreter } from "../backends/svml/svml-interpreter";
import * as fs from "fs";
import { parse } from "../parser/parser-adapter";
import { analyze } from "../resolver";
/**
 * Standalone function to parse Python to Python AST without translation to ESTree
 */
function parsePythonToAst(
  code: string,
  variant: number = 1,
  doValidate: boolean = false,
): SVMLProgram {
  const script = code + "\n";
  const ast = parse(script);
  if (doValidate) {
    analyze(ast, script, variant);
  }
  const compiler = SVMLCompiler.fromProgram(ast);
  const program = compiler.compileProgram(ast);
  return program;
}

function interpretSVMProgram(program: SVMLProgram) {
  try {
    console.log("Initializing SVML Interpreter with ", program);
    const interpreter = new SVMLInterpreter(program, undefined);

    console.log("Executing program...", interpreter);
    const result = interpreter.execute();
    console.log("Execution result:", result);
  } catch (error) {
    console.error("Error interpreting SVM program:", error);
    if (error instanceof Error) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

/**
 * CLI tool for interpreting Python code
 */
function main() {
  const program = new Command();

  program.name("svmi").description("SVML Interpreter - Run SVM program").version("1.0.0");

  program
    .command("interpret")
    .description("Interpret SVM program")
    .argument("<input-file>", "SVM program file to run")
    .action((inputFile: string) => {
      if (!fs.existsSync(inputFile)) {
        console.error(`Error: File '${inputFile}' not found`);
        process.exit(1);
      }

      try {
        const bin = fs.readFileSync(inputFile);
        const program = disassemble(bin);
        interpretSVMProgram(program);
      } catch (error) {
        console.error(`Error reading file '${inputFile}':`, error);
        process.exit(1);
      }
    });

  program
    .command("interpretPython")
    .description("Interpret Python code directly")
    .argument("<input-file>", "Python file to interpret")
    .action((inputFile: string) => {
      const pythonCode = fs.readFileSync(inputFile, "utf8");
      const program = parsePythonToAst(pythonCode, 1, true);
      interpretSVMProgram(program);
    });

  program.parse(process.argv);
}

// Run the CLI if this file is executed directly
if (require.main === module) {
  main();
}

export { interpretSVMProgram };
