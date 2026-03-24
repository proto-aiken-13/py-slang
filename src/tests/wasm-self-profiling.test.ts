import { describe, it, expect } from "@jest/globals";
import { WasmBackend } from "../backends/wasm/wasm-backend";
import { parse } from "../parser/parser-adapter";
import { StmtNS } from "../ast-types";
import { INT_BIT } from "../types/abstract-value";

async function run(src: string, profiling = false) {
  const ast = parse(src + "\n");
  const backend = new WasmBackend(profiling ? { profiling: true } : undefined);
  const result = await backend.run(ast, new Map());
  const typeInfo = backend.collectTypeInfo();
  return { result, typeInfo, ast };
}

describe("WasmBackend self-profiling", () => {
  it("collectTypeInfo() returns empty map when profiling is disabled (default)", async () => {
    const { typeInfo } = await run(`
def add(a, b):
    return a + b
add(1, 2)
`);
    expect(typeInfo.size).toBe(0);
  });

  it("collectTypeInfo() returns empty map before run()", () => {
    const backend = new WasmBackend({ profiling: true });
    expect(backend.collectTypeInfo().size).toBe(0);
  });

  it("collectTypeInfo() maps FunctionDef node to integer profile after run", async () => {
    const src = `
def double(n):
    return n + n
double(5)
`;
    const ast = parse(src + "\n");
    const backend = new WasmBackend({ profiling: true });
    await backend.run(ast, new Map());
    const typeInfo = backend.collectTypeInfo();

    expect(typeInfo.size).toBeGreaterThan(0);
    // The key must be a FunctionDef AST node
    const keys = [...typeInfo.keys()];
    expect(keys[0]).toBeInstanceOf(StmtNS.FunctionDef);
    // Param 0 should be INT
    const profiles = typeInfo.get(keys[0])!;
    expect(profiles).toHaveLength(1);
    expect(profiles[0].get(0)!.sound.kinds).toBe(INT_BIT);
  });

  it("profiling does not corrupt ComputationalResult output", async () => {
    const src = `
def square(x):
    return x * x
square(4)
`;
    const ast = parse(src + "\n");
    const backendPlain = new WasmBackend();
    const backendProf = new WasmBackend({ profiling: true });
    const plainResult = await backendPlain.run(ast, new Map());
    const profResult = await backendProf.run(ast, new Map());

    expect(profResult.value).toEqual(plainResult.value);
    expect(profResult.stdout).toEqual(plainResult.stdout);
    expect(profResult.stderr).toEqual(plainResult.stderr);
  });

  it("function never called does not appear in collectTypeInfo()", async () => {
    const src = `
def never_called(x):
    return x
def called(y):
    return y
called(1)
`;
    const ast = parse(src + "\n");
    const backend = new WasmBackend({ profiling: true });
    await backend.run(ast, new Map());
    const typeInfo = backend.collectTypeInfo();

    // Only 'called' should appear; 'never_called' has all 0xFF cells
    expect(typeInfo.size).toBe(1);
    const [node] = typeInfo.keys();
    expect((node as StmtNS.FunctionDef).name.lexeme).toBe("called");
  });
});
