/**
 * Tests for specialized opcode execution paths.
 * Each test triggers JIT specialization and verifies the specialized
 * opcode path produces correct results.
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

describe("Specialized opcode paths", () => {
  describe("Arithmetic (ADDF, SUBF, MULF, DIVF, FLOORDIVF, MODF)", () => {
    test("ADDF: addition with known-positive args", () => {
      const code = `
def add(x, y):
    return x + y
add(3, 4)
`;
      expect(compileAndRunWithJIT(code)).toBe(7);
    });

    test("SUBF: subtraction with known-positive args", () => {
      const code = `
def sub(x, y):
    return x - y
sub(10, 3)
`;
      expect(compileAndRunWithJIT(code)).toBe(7);
    });

    test("MULF: multiplication with known-negative args", () => {
      const code = `
def mul(x, y):
    return x * y
mul(-3, -4)
`;
      expect(compileAndRunWithJIT(code)).toBe(12);
    });

    test("DIVF: division with known-positive args", () => {
      const code = `
def div(x, y):
    return x / y
div(10, 4)
`;
      expect(compileAndRunWithJIT(code)).toBe(2.5);
    });

    test("FLOORDIVF: floor division with known-positive args", () => {
      const code = `
def floordiv(x, y):
    return x // y
floordiv(7, 2)
`;
      expect(compileAndRunWithJIT(code)).toBe(3);
    });

    test("MODF: modulo with known-positive args", () => {
      const code = `
def mod(x, y):
    return x % y
mod(10, 3)
`;
      expect(compileAndRunWithJIT(code)).toBe(1);
    });
  });

  describe("Unary (NEGF, NOTB)", () => {
    test("NEGF: negate a known-positive number", () => {
      const code = `
def neg(x):
    return -x
neg(5)
`;
      expect(compileAndRunWithJIT(code)).toBe(-5);
    });

    test("NOTB: negate a known boolean (True -> False)", () => {
      const code = `
def negate(b):
    return not b
negate(True)
`;
      expect(compileAndRunWithJIT(code)).toBe(false);
    });

    test("NOTB: negate a known boolean (False -> True)", () => {
      const code = `
def negate(b):
    return not b
negate(False)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });
  });

  describe("Comparison (LTF, GTF, LEF, GEF, EQF, EQB, NEQF, NEQB)", () => {
    test("LTF: less-than with known numbers", () => {
      const code = `
def lt(x, y):
    return x < y
lt(3, 5)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });

    test("GTF: greater-than with known numbers", () => {
      const code = `
def gt(x, y):
    return x > y
gt(5, 3)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });

    test("LEF: less-or-equal with equal known numbers", () => {
      const code = `
def le(x, y):
    return x <= y
le(3, 3)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });

    test("GEF: greater-or-equal with known numbers", () => {
      const code = `
def ge(x, y):
    return x >= y
ge(5, 3)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });

    test("EQF: equality with same known numbers", () => {
      const code = `
def eq(x, y):
    return x == y
eq(3, 3)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });

    test("NEQF: not-equal with different known numbers", () => {
      const code = `
def neq(x, y):
    return x != y
neq(3, 4)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });

    test("EQB: boolean equality", () => {
      const code = `
def beq(a, b):
    return a == b
beq(True, True)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });

    test("NEQB: boolean not-equal", () => {
      const code = `
def bneq(a, b):
    return a != b
bneq(True, False)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });
  });

  describe("Variable load/store (LDLF, LDLB, STLF, STLB)", () => {
    test("LDLF/STLF: load and store typed number local", () => {
      const code = `
def f(x):
    y = x + 1
    return y
f(5)
`;
      expect(compileAndRunWithJIT(code)).toBe(6);
    });

    test("LDLB/STLB: load and store typed boolean local", () => {
      const code = `
def f(b):
    c = not b
    return c
f(True)
`;
      expect(compileAndRunWithJIT(code)).toBe(false);
    });
  });

  describe("Return (RETF, RETB)", () => {
    test("RETF: return typed number", () => {
      const code = `
def f(x):
    return x + 1
f(10)
`;
      expect(compileAndRunWithJIT(code)).toBe(11);
    });

    test("RETB: return typed boolean", () => {
      const code = `
def f(x):
    return x > 0
f(5)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });
  });

  describe("Mixed specialization correctness", () => {
    test("same function called with different types produces correct results", () => {
      const code = `
def identity(x):
    return x

r1 = identity(42)
r2 = identity(True)
r3 = identity(-7)
r1
`;
      expect(compileAndRunWithJIT(code)).toBe(42);
    });

    test("specialized arithmetic in recursive function", () => {
      const code = `
def sum_to(n):
    if n <= 0:
        return 0
    else:
        return n + sum_to(n - 1)

sum_to(10)
`;
      expect(compileAndRunWithJIT(code)).toBe(55);
    });

    test("specialization with negative arguments", () => {
      const code = `
def abs_val(x):
    if x < 0:
        return -x
    else:
        return x

abs_val(-42)
`;
      expect(compileAndRunWithJIT(code)).toBe(42);
    });

    test("boolean logic with specialized paths", () => {
      const code = `
def and_fn(a, b):
    if a and b:
        return True
    else:
        return False

and_fn(True, True)
`;
      expect(compileAndRunWithJIT(code)).toBe(true);
    });
  });
});
