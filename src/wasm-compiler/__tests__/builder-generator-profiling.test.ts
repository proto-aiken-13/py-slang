import { describe, it, expect } from "@jest/globals";
import { BuilderGenerator } from "../builderGenerator";
import { parse } from "../../parser/parser-adapter";
import { MAX_PARAMS_TRACKED } from "../wasm-profiling";
import { WatGenerator } from "@sourceacademy/wasm-util";

function buildWat(src: string, profiling = false): string {
  const ast = parse(src + "\n");
  const gen = new BuilderGenerator();
  if (profiling) gen.withProfilingEnabled();
  const watIR = gen.visit(ast);

  return new WatGenerator().visit(watIR);
}

describe("BuilderGenerator profiling instrumentation", () => {
  it("emits profiling_base global when profiling is enabled", () => {
    const wat = buildWat(`
def foo(x):
    return x
foo(1)
`, true);
    expect(wat).toContain("profiling_base");
  });

  it("emits memory.fill for profiling region initialization in $main", () => {
    const wat = buildWat(`
def bar(y):
    return y
bar(2)
`, true);
    expect(wat).toContain("memory.fill");
  });

  it("does NOT emit profiling_base global when profiling is disabled", () => {
    const wat = buildWat(`
def baz(z):
    return z
baz(3)
`);
    expect(wat).not.toContain("profiling_base");
  });

  it("funcArities reflects parameter count", () => {
    const src = `
def f(a, b, c):
    return a
f(1, 2, 3)
`;
    const ast = parse(src + "\n");
    const gen = new BuilderGenerator();
    gen.withProfilingEnabled();
    gen.visit(ast);
    const arities = gen.getFuncArities();
    // getFuncArities() returns user-defined function arities only (no builtins)
    expect(arities[0]).toBe(3);
  });
});
