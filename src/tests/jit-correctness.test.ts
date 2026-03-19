import { parse } from "../parser/parser-adapter";
import { SVMLCompiler } from "../vm/svml-compiler";
import { SVMLInterpreter } from "../vm/svml-interpreter";
import { SVMLBoxType } from "../vm/types";
import { WasmBackend } from "../wasm-compiler/wasm-backend";
import type { StmtNS } from "../ast-types";

function runNoJIT(code: string): SVMLBoxType {
  const src = code.endsWith("\n") ? code : code + "\n";
  const ast = parse(src);
  const compiler = SVMLCompiler.fromProgram(ast);
  const program = compiler.compileProgram(ast);
  return SVMLInterpreter.toJSValue(
    new SVMLInterpreter(program, compiler.getInstrumentation()).execute()
  );
}

function runJIT(code: string): SVMLBoxType {
  const src = code.endsWith("\n") ? code : code + "\n";
  const ast = parse(src);
  const compiler = SVMLCompiler.fromProgram(ast);
  const program = compiler.compileProgram(ast);
  return SVMLInterpreter.toJSValue(
    new SVMLInterpreter(program, compiler.getInstrumentation(), compiler).execute()
  );
}

async function runWasm(code: string): Promise<number | boolean | null> {
  const src = code.endsWith("\n") ? code : code + "\n";
  const ast = parse(src) as StmtNS.FileInput;
  const result = await new WasmBackend().run(ast, new Map());
  if (result.stderr) throw new Error(`wasm stderr: ${result.stderr}`);
  const v = result.value;
  switch (v.tag) {
    case "int":  return v.value;
    case "bool": return v.value;
    case "none": return null;
    default:     throw new Error(`unhandled tag: ${v.tag}`);
  }
}

// ============================================================
// Test case data: { name, code, expected }
// Each case is automatically run through both JIT and no-JIT.
// ============================================================

const CASES: Array<{ name: string; code: string; expected: any; skipWasm?: true; skipNoJit?: true }> = [
  // ---- Sign arithmetic ----
  { name: "pos + pos = pos", code: "def f(x,y):\n  return x + y\nf(3,4)", expected: 7 },
  { name: "neg + neg = neg", code: "def f(x,y):\n  return x + y\nf(-3,-4)", expected: -7 },
  { name: "pos + neg = int", code: "def f(x,y):\n  return x + y\nf(3,-4)", expected: -1 },
  { name: "pos - pos = int", code: "def f(x,y):\n  return x - y\nf(3,4)", expected: -1 },
  { name: "pos * pos = pos", code: "def f(x,y):\n  return x * y\nf(3,4)", expected: 12 },
  { name: "pos * neg = neg", code: "def f(x,y):\n  return x * y\nf(3,-4)", expected: -12 },
  { name: "neg * neg = pos", code: "def f(x,y):\n  return x * y\nf(-3,-4)", expected: 12 },
  { name: "pos * zero = zero", code: "def f(x,y):\n  return x * y\nf(3,0)", expected: 0 },
  { name: "zero + pos = pos", code: "def f(x,y):\n  return x + y\nf(0,5)", expected: 5 },

  // ---- Division edge cases ----
  { name: "pos / pos", code: "def f(x,y):\n  return x / y\nf(6,3)", expected: 2 },
  { name: "neg / neg", code: "def f(x,y):\n  return x / y\nf(-6,-3)", expected: 2 },
  { name: "pos / neg", code: "def f(x,y):\n  return x / y\nf(6,-3)", expected: -2 },
  { name: "neg / pos", code: "def f(x,y):\n  return x / y\nf(-6,3)", expected: -2 },
  // WASM SKIP: `%` (modulo) operator is not yet implemented in the wasm compiler.
  // Remove `skipWasm: true` once wasm vocabulary includes the modulo operator.
  { name: "pos % pos", code: "def f(x,y):\n  return x % y\nf(7,3)", expected: 1, skipWasm: true },
  { name: "neg % pos", code: "def f(x,y):\n  return x % y\nf(-7,3)", expected: 2, skipWasm: true },

  // ---- Comparison folding ----
  { name: "pos > zero = true", code: "def f(x,y):\n  return x > y\nf(5,0)", expected: true },
  { name: "pos > neg = true", code: "def f(x,y):\n  return x > y\nf(5,-3)", expected: true },
  { name: "neg > zero = false", code: "def f(x,y):\n  return x > y\nf(-5,0)", expected: false },
  { name: "zero > zero = false", code: "def f(x,y):\n  return x > y\nf(0,0)", expected: false },
  { name: "neg < zero = true", code: "def f(x,y):\n  return x < y\nf(-5,0)", expected: true },
  { name: "pos < neg = false", code: "def f(x,y):\n  return x < y\nf(5,-3)", expected: false },
  { name: "pos >= zero = true", code: "def f(x,y):\n  return x >= y\nf(5,0)", expected: true },
  { name: "zero >= zero = true", code: "def f(x,y):\n  return x >= y\nf(0,0)", expected: true },
  { name: "neg <= zero = true", code: "def f(x,y):\n  return x <= y\nf(-5,0)", expected: true },
  { name: "pos == neg = false", code: "def f(x,y):\n  return x == y\nf(5,-3)", expected: false },
  { name: "pos != neg = true", code: "def f(x,y):\n  return x != y\nf(5,-3)", expected: true },
  { name: "zero == zero = true", code: "def f(x,y):\n  return x == y\nf(0,0)", expected: true },
  { name: "zero != zero = false", code: "def f(x,y):\n  return x != y\nf(0,0)", expected: false },

  // ---- Dead branch elimination ----
  { name: "if pos>0: takes true branch", code: "def f(x):\n  if x > 0:\n    return 1\n  else:\n    return 2\nf(5)", expected: 1 },
  { name: "if neg>0: takes false branch", code: "def f(x):\n  if x > 0:\n    return 1\n  else:\n    return 2\nf(-5)", expected: 2 },
  { name: "if zero>0: takes false branch", code: "def f(x):\n  if x > 0:\n    return 1\n  else:\n    return 2\nf(0)", expected: 2 },
  { name: "nested branch elimination",
    code: "def f(a,b):\n  if a > 0:\n    if b > 0:\n      return 1\n    else:\n      return 2\n  else:\n    return 3\nf(5,5)",
    expected: 1 },
  { name: "nested branch — else path",
    code: "def f(a,b):\n  if a > 0:\n    if b > 0:\n      return 1\n    else:\n      return 2\n  else:\n    return 3\nf(-1,5)",
    expected: 3 },

  // ---- Full branch_test (the benchmark case) ----
  { name: "branch_test sum of all 8 combos",
    code: `def bt(a,b,c):
  if a > 0:
    if b < 0:
      if c > 0:
        return -3
      else:
        return -2
    else:
      if c > 0:
        return -1
      else:
        return 0
  else:
    if b < 0:
      if c > 0:
        return 1
      else:
        return 2
    else:
      if c > 0:
        return 3
      else:
        return 4
bt(1,-1,1)+bt(1,-1,0)+bt(1,0,1)+bt(1,0,0)+bt(0,-1,1)+bt(0,-1,0)+bt(0,0,1)+bt(0,0,0)`,
    expected: 4 },

  // ---- Boolean operations ----
  { name: "True and True = True", code: "def f():\n  return True and True\nf()", expected: true },
  { name: "True and False = False", code: "def f():\n  return True and False\nf()", expected: false },
  { name: "False and True = False", code: "def f():\n  return False and True\nf()", expected: false },
  { name: "True or False = True", code: "def f():\n  return True or False\nf()", expected: true },
  { name: "False or True = True", code: "def f():\n  return False or True\nf()", expected: true },
  { name: "False or False = False", code: "def f():\n  return False or False\nf()", expected: false },

  // ---- Unary ----
  { name: "-pos = neg", code: "def f(x):\n  return -x\nf(5)", expected: -5 },
  { name: "-neg = pos", code: "def f(x):\n  return -x\nf(-5)", expected: 5 },
  // WASM SKIP: wasm integers cannot represent -0 (negative zero); wasm returns 0.
  // Remove `skipWasm: true` if/when the wasm backend handles floats or -0 explicitly.
  { name: "-zero = zero", code: "def f(x):\n  return -x\nf(0)", expected: -0, skipWasm: true },
  { name: "not True = False", code: "def f():\n  return not True\nf()", expected: false },
  { name: "not False = True", code: "def f():\n  return not False\nf()", expected: true },

  // ---- Recursive with JIT ----
  { name: "fibonacci(10) = 55",
    code: "def fib(n):\n  if n <= 1:\n    return n\n  else:\n    return fib(n-1) + fib(n-2)\nfib(10)",
    expected: 55 },
  { name: "factorial(6) = 720",
    code: "def fact(n):\n  if n <= 1:\n    return 1\n  else:\n    return n * fact(n-1)\nfact(6)",
    expected: 720 },

  // ---- While loops ----
  // WASM SKIP: while loops are not yet fully implemented in the wasm compiler.
  // Remove `skipWasm: true` once wasm vocabulary includes while loop support.
  { name: "while countdown",
    code: "def f(n):\n  total = 0\n  while n > 0:\n    total = total + n\n    n = n - 1\n  return total\nf(5)",
    expected: 15, skipWasm: true },
  { name: "while with zero iterations",
    code: "def f(n):\n  x = 42\n  while n > 0:\n    x = 0\n    n = n - 1\n  return x\nf(0)",
    expected: 42, skipWasm: true },

  // ---- Mixed/unknown types (should not crash) ----
  // WASM SKIP: passing `None` as a function argument is not yet handled by the wasm compiler.
  // Remove `skipWasm: true` once wasm compiler supports None-typed call arguments.
  { name: "function returns constant int",
    code: "def f(x):\n  return 42\nf(None)",
    expected: 42, skipWasm: true },

  // ---- Division regression: sign of quotient ----
  { name: "6/3 > 0 is true (divSigns regression)",
    code: "def f(x,y):\n  return (x / y) > 0\nf(6,3)",
    expected: true },
  { name: "neg/pos < 0 is true",
    code: "def f(x,y):\n  return (x / y) < 0\nf(-6,3)",
    expected: true },

  // ---- Boolean short-circuit with proven operands ----
  { name: "True and (pos>0) = True",
    code: "def f(x):\n  return True and x > 0\nf(5)",
    expected: true },
  { name: "False and (pos>0) = False",
    code: "def f(x):\n  return False and x > 0\nf(5)",
    expected: false },
  { name: "True or (neg>0) = True",
    code: "def f(x):\n  return True or x > 0\nf(-5)",
    expected: true },
  { name: "False or (pos>0) = True",
    code: "def f(x):\n  return False or x > 0\nf(5)",
    expected: true },

  // ---- NOT on known bool ----
  { name: "not (pos>0) = not True = False",
    code: "def f(x):\n  return not (x > 0)\nf(5)",
    expected: false },
  { name: "not (neg>0) = not False = True",
    code: "def f(x):\n  return not (x > 0)\nf(-5)",
    expected: true },

  // ---- Ternary with known condition ----
  { name: "x if pos>0 else y = x",
    code: "def f(a):\n  return 1 if a > 0 else 2\nf(5)",
    expected: 1 },
  { name: "x if neg>0 else y = y",
    code: "def f(a):\n  return 1 if a > 0 else 2\nf(-5)",
    expected: 2 },

  // ---- Arithmetic with zero ----
  { name: "x + 0 = x (zero identity)",
    code: "def f(x,y):\n  return x + y\nf(42,0)",
    expected: 42 },
  { name: "0 + x = x (zero identity)",
    code: "def f(x,y):\n  return x + y\nf(0,42)",
    expected: 42 },
  { name: "x - 0 = x",
    code: "def f(x,y):\n  return x - y\nf(42,0)",
    expected: 42 },
  { name: "x * 0 = 0",
    code: "def f(x,y):\n  return x * y\nf(42,0)",
    expected: 0 },
  { name: "0 * x = 0",
    code: "def f(x,y):\n  return x * y\nf(0,42)",
    expected: 0 },

  // ---- Comparison ----
  { name: "int less-than true", code: "def f(x,y):\n  return x < y\nf(3,5)", expected: true },
  { name: "int less-than false", code: "def f(x,y):\n  return x < y\nf(5,3)", expected: false },
  { name: "int equal true", code: "def f(x,y):\n  return x == y\nf(4,4)", expected: true },
  { name: "int not-equal true", code: "def f(x,y):\n  return x != y\nf(4,5)", expected: true },
  { name: "int gte true", code: "def f(x,y):\n  return x >= y\nf(5,3)", expected: true },
  { name: "int lte equal", code: "def f(x,y):\n  return x <= y\nf(3,3)", expected: true },

  // ---- Unary ----
  { name: "bool NOT True", code: "def f(x):\n  return not x\nf(True)", expected: false },
  { name: "bool NOT False", code: "def f(x):\n  return not x\nf(False)", expected: true },
  { name: "int NEG positive", code: "def f(x):\n  return -x\nf(5)", expected: -5 },
  { name: "int NEG negative", code: "def f(x):\n  return -x\nf(-3)", expected: 3 },
  { name: "bool NOT int zero (fallback to generic)", code: "def f(x):\n  return not x\nf(0)", expected: true, skipNoJit: true },

  // ---- While True with break ----
  // WASM SKIP: `break` statement is not yet supported by the wasm compiler.
  // Remove `skipWasm: true` once wasm vocabulary includes break/continue.
  { name: "while True with break",
    code: "def f():\n  x = 0\n  while True:\n    x = x + 1\n    if x == 5:\n      break\n  return x\nf()",
    expected: 5, skipWasm: true },
];

// ============================================================
// Run every case through both modes
// ============================================================

describe.each(CASES)("$name", ({ code, expected, skipWasm = false, skipNoJit = false }) => {
  (skipNoJit ? test.skip : test)("no-JIT", () => {
    expect(runNoJIT(code)).toBe(expected);
  });

  test("JIT", () => {
    expect(runJIT(code)).toBe(expected);
  });

  (skipWasm ? test.skip : test)("wasm", async () => {
    expect(await runWasm(code)).toBe(expected);
  });
});
