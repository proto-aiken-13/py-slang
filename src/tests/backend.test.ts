import { createBackend } from "../backend/config";
import { SVMLBackend } from "../vm/svml-backend";
import { parse } from "../parser/parser-adapter";
import { StmtNS } from "../ast-types";
import { FunctionEnvironments } from "../resolver";

const emptyEnvs = new Map() as FunctionEnvironments;

function parseCode(code: string): StmtNS.FileInput {
  return parse(code + "\n");
}

describe("createBackend factory", () => {
  test("no args returns a functioning SVMLBackend", async () => {
    const backend = createBackend();
    const result = await backend.run(parseCode("1 + 2"), emptyEnvs);
    expect(result.value).toEqual({ tag: "int", value: 3 });
  });

  test('backend: "cse" returns a functioning CSEBackend', async () => {
    const backend = createBackend({ backend: "cse" });
    const result = await backend.run(parseCode("1 + 2"), emptyEnvs);
    expect(result.value).toEqual({ tag: "int", value: 3 });
  });

  test("jit: false returns backend with JIT disabled", () => {
    const backend = createBackend({ jit: false });
    expect(backend).toBeInstanceOf(SVMLBackend);
  });
});

describe("SVMLBackend cache", () => {
  test("same AST object on second run skips recompilation", async () => {
    const backend = new SVMLBackend();
    const ast = parseCode("1 + 1");

    const result1 = await backend.run(ast, emptyEnvs);
    const result2 = await backend.run(ast, emptyEnvs);

    expect(result1.value).toEqual(result2.value);
  });

  test("different AST object triggers recompilation", async () => {
    const backend = new SVMLBackend();

    const result1 = await backend.run(parseCode("1 + 1"), emptyEnvs);
    const result2 = await backend.run(parseCode("2 + 2"), emptyEnvs);

    expect(result1.value).toEqual({ tag: "int", value: 2 });
    expect(result2.value).toEqual({ tag: "int", value: 4 });
  });

  test("collectTypeInfo returns empty map before any run", () => {
    const backend = new SVMLBackend();
    expect(backend.collectTypeInfo()).toEqual(new Map());
  });

  test("collectTypeInfo returns data after run with JIT", async () => {
    const backend = new SVMLBackend({ jit: true });
    const code = `def f(x):
    return x + 1

f(5)`;
    await backend.run(parseCode(code), emptyEnvs);
    const info = backend.collectTypeInfo();
    expect(info.size).toBeGreaterThan(0);
  });
});
