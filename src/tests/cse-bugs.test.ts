import { ExprNS } from "../ast-types";
import { Token } from "../tokenizer/tokenizer";
import { TokenType } from "../tokens";
import { isEnvDependent } from "../cse-machine/utils";

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
