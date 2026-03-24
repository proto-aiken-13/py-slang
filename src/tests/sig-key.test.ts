/**
 * Tests for specialization signature key computation.
 * Validates that the sig key mechanism correctly distinguishes
 * type signatures even with many arguments (>7).
 */
import { parse } from "../parser/parser-adapter";
import { SVMLCompiler } from "../vm/svml-compiler";
import { SVMLInterpreter } from "../vm/svml-interpreter";

function compileAndRunWithJIT(code: string): unknown {
  const ast = parse(code);
  const compiler = SVMLCompiler.fromProgram(ast);
  const program = compiler.compileProgram(ast);
  const instrumentation = compiler.getInstrumentation();
  const interpreter = new SVMLInterpreter(program, instrumentation, compiler);
  const result = interpreter.execute();
  return SVMLInterpreter.toJSValue(result);
}

describe("Sig key precision", () => {
  test("8-arg function with different type signatures produces distinct results", () => {
    const code = `
def f(a, b, c, d, e, f_arg, g, h):
    return a + b + c + d + e + f_arg + g + h

f(1, 2, 3, 4, 5, 6, 7, 8)
`;
    expect(compileAndRunWithJIT(code)).toBe(36);
  });

  test("8-arg function: all-positive vs mixed signs produce correct results", () => {
    const code = `
def f(a, b, c, d, e, f_arg, g, h):
    return a + b + c + d + e + f_arg + g + h

r1 = f(1, 2, 3, 4, 5, 6, 7, 8)
r2 = f(-1, -2, -3, -4, -5, -6, -7, -8)
r1 + r2
`;
    // r1 = 36, r2 = -36, sum = 0
    expect(compileAndRunWithJIT(code)).toBe(0);
  });

  test("10-arg function produces correct results with JIT", () => {
    const code = `
def big(a, b, c, d, e, f_arg, g, h, i, j):
    return a + b + c + d + e + f_arg + g + h + i + j

big(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
`;
    expect(compileAndRunWithJIT(code)).toBe(55);
  });

  test("different type signatures at 8+ args don't collide", () => {
    // Call with all-positive, then with last arg negative.
    // These must produce different specializations.
    const code = `
def check(a, b, c, d, e, f_arg, g, h):
    if h > 0:
        return 1
    else:
        return -1

r1 = check(1, 1, 1, 1, 1, 1, 1, 1)
r2 = check(1, 1, 1, 1, 1, 1, 1, -1)
r1 * 10 + r2
`;
    // r1=1, r2=-1, result = 10 + (-1) = 9
    // This verifies distinct sig keys produce distinct specializations
    expect(compileAndRunWithJIT(code)).toBe(9);
  });

  test("2-arg function: positive vs negative signatures are distinct", () => {
    // Simpler version of the above to isolate the issue
    const code = `
def check(x):
    if x > 0:
        return 1
    else:
        return -1

r1 = check(5)
r2 = check(-5)
r1 * 10 + r2
`;
    expect(compileAndRunWithJIT(code)).toBe(9);
  });

  test("8-arg single call with JIT: negative last arg", () => {
    const code = `
def check(a, b, c, d, e, f_arg, g, h):
    if h > 0:
        return 1
    else:
        return -1

check(1, 1, 1, 1, 1, 1, 1, -1)
`;
    // NOTE: This test exposes a pre-existing specialization bug with >7 args.
    // The sig key fix (string keys) prevents precision loss at 7+ args,
    // but the underlying slot lookup may still have issues with many params.
    // Marking as known limitation for now.
    expect(compileAndRunWithJIT(code)).toBe(-1);
  });

  test("8-arg without JIT works correctly", () => {
    // Same test but without JIT to verify baseline
    const code = `
def check(a, b, c, d, e, f_arg, g, h):
    if h > 0:
        return 1
    else:
        return -1

r1 = check(1, 1, 1, 1, 1, 1, 1, 1)
r2 = check(1, 1, 1, 1, 1, 1, 1, -1)
r1 * 10 + r2
`;
    // Use non-JIT path
    const ast = parse(code);
    const compiler = SVMLCompiler.fromProgram(ast);
    const program = compiler.compileProgram(ast);
    const instrumentation = compiler.getInstrumentation();
    const interpreter = new SVMLInterpreter(program, instrumentation);
    const result = interpreter.execute();
    expect(SVMLInterpreter.toJSValue(result)).toBe(9);
  });
});
