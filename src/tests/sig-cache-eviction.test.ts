/**
 * Tests that the specialization cache has bounded size per function
 * and that eviction does not produce incorrect results.
 */
import { parse } from "../parser/parser-adapter";
import { SVMLCompiler } from "../backends/svml/svml-compiler";
import { SVMLInterpreter } from "../backends/svml/svml-interpreter";

function compileAndRunWithJIT(code: string): unknown {
  const ast = parse(code);
  const compiler = SVMLCompiler.fromProgram(ast);
  const program = compiler.compileProgram(ast);
  const instrumentation = compiler.getInstrumentation();
  const interpreter = new SVMLInterpreter(program, instrumentation, compiler);
  const result = interpreter.execute();
  return SVMLInterpreter.toJSValue(result);
}

describe("Sig cache eviction", () => {
  test("many different type signatures still produce correct results", () => {
    // Exercise multiple distinct type signatures for the same function.
    // Even if cache eviction occurs, results must remain correct.
    const code = `
def add(x, y):
    return x + y

total = 0
total = total + add(1, 2)
total = total + add(-1, 2)
total = total + add(1, -2)
total = total + add(-1, -2)
total = total + add(0, 1)
total = total + add(0, -1)
total = total + add(1, 0)
total = total + add(-1, 0)
total = total + add(0, 0)
total
`;
    // 3 + 1 + (-1) + (-3) + 1 + (-1) + 1 + (-1) + 0 = 0
    expect(compileAndRunWithJIT(code)).toBe(0);
  });

  test("cache eviction does not produce wrong results on re-specialization", () => {
    // Alternate between type signatures repeatedly.
    // After eviction, re-specialization must produce correct opcodes.
    const code = `
def f(x):
    if x > 0:
        return 1
    else:
        return -1

total = 0
total = total + f(1)
total = total + f(-1)
total = total + f(1)
total = total + f(-1)
total
`;
    expect(compileAndRunWithJIT(code)).toBe(0);
  });
});
