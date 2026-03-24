import { describe, it, expect } from "@jest/globals";
import { parse } from "../parser/parser-adapter";
import { StmtNS } from "../ast-types";
import { WasmJITBackend } from "../backends/wasm/wasm-jit-backend";

function parseCode(code: string): StmtNS.FileInput {
  const src = code.endsWith("\n") ? code : code + "\n";
  return parse(src);
}

async function runJIT(code: string): Promise<number | boolean | null> {
  const ast = parseCode(code);
  const backend = new WasmJITBackend();
  const result = await backend.run(ast, new Map());
  if (result.stderr) throw new Error(`wasm-jit stderr: ${result.stderr}`);
  const v = result.value;
  switch (v.tag) {
    case "int":
      return v.value;
    case "bool":
      return v.value;
    case "none":
      return null;
    default:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`unhandled tag: ${(v as any).tag}`);
  }
}

describe("WasmJITBackend", () => {
  test("collectTypeInfo() before run() returns empty map", () => {
    const backend = new WasmJITBackend();
    expect(backend.collectTypeInfo().size).toBe(0);
  });

  test("returns correct result for integer addition", async () => {
    expect(await runJIT("def f(x, y):\n  return x + y\nf(3, 4)")).toBe(7);
  });

  test("returns correct result for integer subtraction", async () => {
    expect(await runJIT("def f(x, y):\n  return x - y\nf(10, 3)")).toBe(7);
  });

  test("returns correct result for integer multiplication", async () => {
    expect(await runJIT("def f(x, y):\n  return x * y\nf(3, 4)")).toBe(12);
  });

  test("returns correct result for program with no functions", async () => {
    expect(await runJIT("1 + 2")).toBe(3);
  });

  test("collectTypeInfo() after run() returns non-empty map for typed call", async () => {
    const ast = parseCode("def f(x, y):\n  return x + y\nf(3, 4)");
    const backend = new WasmJITBackend();
    await backend.run(ast, new Map());
    expect(backend.collectTypeInfo().size).toBe(1);
  });

  test("run() called twice returns consistent results", async () => {
    const ast = parseCode("def f(x, y):\n  return x + y\nf(3, 4)");
    const backend = new WasmJITBackend();
    const r1 = await backend.run(ast, new Map());
    const r2 = await backend.run(ast, new Map());
    expect(r1.value).toEqual(r2.value);
    expect(r1.stderr).toBe("");
    expect(r2.stderr).toBe("");
  });

  test("collectTypeInfo() returns non-empty TypeInformation after run", async () => {
    const src = `
def add(a, b):
    return a + b
add(1, 2)
`;
    const ast = parseCode(src);
    const backend = new WasmJITBackend();
    await backend.run(ast, new Map());
    const typeInfo = backend.collectTypeInfo();

    expect(typeInfo.size).toBeGreaterThan(0);
    // Keys are SpecializableFunctionNode objects (FunctionDef or Lambda AST nodes).
    for (const key of typeInfo.keys()) {
      expect(key).toBeInstanceOf(StmtNS.FunctionDef);
    }
  });

  test("produces same result as manually wired SVML+Wasm pipeline", async () => {
    const { SVMLBackend } = await import("../vm/svml-backend");
    const { SVMLCompiler } = await import("../vm/svml-compiler");
    const { specialize } = await import("../specialization/enrich");
    const { WasmBackend } = await import("../wasm-compiler/wasm-backend");

    const code = "def f(x, y):\n  return x + y\nf(5, 6)\n";
    const ast = parseCode(code);

    const svml = new SVMLBackend({ jit: true });
    await svml.run(ast, new Map());
    const typeInfo = svml.collectTypeInfo();
    const compiler = SVMLCompiler.fromProgram(ast);
    compiler.compileProgram(ast);
    const enriched = specialize(ast, typeInfo, fn => compiler.createSlotLookupForFunction(fn));
    const manualResult = await new WasmBackend().run(enriched, new Map());

    const backend = new WasmJITBackend();
    const jitResult = await backend.run(ast, new Map());

    expect(jitResult.value).toEqual(manualResult.value);
    expect(jitResult.stderr).toBe(manualResult.stderr);
  });
});
