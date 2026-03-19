import { describe, it, expect } from "@jest/globals";
import { BuilderGenerator } from "../builderGenerator";
import { BackwardsBindings } from "../../backend/backwards-bindings";
import { parse } from "../../parser/parser-adapter";

describe("BuilderGenerator.withProfiling() wires BackwardsBindings", () => {
  it("registers one entry per user FunctionDef", () => {
    const src = `
def foo(x):
    return x + 1

def bar(y, z):
    return y * z

foo(1)
bar(2, 3)
`;
    const ast = parse(src + "\n");
    const bindings = new BackwardsBindings<number>();
    const gen = new BuilderGenerator();
    gen.withProfiling(bindings);
    gen.visit(ast);

    // Two user functions defined at source level
    expect(bindings.size).toBe(2);
  });

  it("registers lambda nodes", () => {
    const src = `f = lambda x: x + 1\nf(1)`;
    const ast = parse(src + "\n");
    const bindings = new BackwardsBindings<number>();
    const gen = new BuilderGenerator();
    gen.withProfiling(bindings);
    gen.visit(ast);

    expect(bindings.size).toBe(1);
  });

  it("does not register built-in functions", () => {
    const src = `print(1)`;
    const ast = parse(src + "\n");
    const bindings = new BackwardsBindings<number>();
    const gen = new BuilderGenerator();
    gen.withProfiling(bindings);
    gen.visit(ast);

    // print is a builtin — no user-defined functions → bindings size 0
    expect(bindings.size).toBe(0);
  });
});
