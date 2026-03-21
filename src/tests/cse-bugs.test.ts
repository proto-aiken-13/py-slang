import { ExprNS } from "../ast-types";
import { Token } from "../tokenizer/tokenizer";
import { TokenType } from "../tokens";
import { isEnvDependent } from "../cse-machine/utils";
import { parse } from "../parser/parser-adapter";
import { evaluate } from "../cse-machine/interpreter";
import { Context } from "../cse-machine/context";

function evalPython(code: string): unknown {
  const src = code + "\n";
  const ast = parse(src);
  const context = new Context();
  return evaluate(src, ast, context);
}

describe("BoolOp short-circuit evaluation", () => {
  test("short-circuit: False and 1//0 should not raise ZeroDivisionError", () => {
    const result = evalPython("False and 1//0");
    expect(result).not.toEqual(expect.objectContaining({ type: "error" }));
  });

  test("short-circuit: True or 1//0 should not raise ZeroDivisionError", () => {
    const result = evalPython("True or 1//0");
    expect(result).not.toEqual(expect.objectContaining({ type: "error" }));
  });

  test("short-circuit: 0 and 42 returns 0", () => {
    const result = evalPython("0 and 42");
    expect(result).toEqual({ type: "bigint", value: 0n });
  });

  test("short-circuit: 1 and 42 returns 42", () => {
    const result = evalPython("1 and 42");
    expect(result).toEqual({ type: "bigint", value: 42n });
  });

  test("short-circuit: 1 or 42 returns 1", () => {
    const result = evalPython("1 or 42");
    expect(result).toEqual({ type: "bigint", value: 1n });
  });

  test("short-circuit: 0 or 42 returns 42", () => {
    const result = evalPython("0 or 42");
    expect(result).toEqual({ type: "bigint", value: 42n });
  });
});

describe("isEnvDependent", () => {
  const dummyToken = new Token(TokenType.NAME, "test", 0, 0, 0);

  test("Call node with env-dependent callee returns true", () => {
    const variable = new ExprNS.Variable(dummyToken, dummyToken, dummyToken);
    const call = new ExprNS.Call(dummyToken, dummyToken, variable, []);
    expect(isEnvDependent(call)).toBe(true);
  });

  test("Grouping node delegates to inner expression", () => {
    const literal = new ExprNS.Literal(dummyToken, dummyToken, 42);
    const grouping = new ExprNS.Grouping(dummyToken, dummyToken, literal);
    expect(isEnvDependent(grouping)).toBe(false);
  });
});
