// src/tests/richer-lattice-specialization.test.ts
import { describe, test, expect } from "@jest/globals";
import { parse } from "../parser/parser-adapter";
import { StmtNS } from "../ast-types";
import { WasmJITBackend } from "../wasm-compiler/wasm-jit-backend";

function parseCode(code: string): StmtNS.FileInput {
  const src = code.endsWith("\n") ? code : code + "\n";
  return parse(src);
}

async function runJITWasm(code: string): Promise<number | boolean | null> {
  const ast = parseCode(code);
  const backend = new WasmJITBackend();
  const result = await backend.run(ast, new Map());
  if (result.stderr) throw new Error(`wasm-jit stderr: ${result.stderr}`);
  const v = result.value;
  switch (v.tag) {
    case "int":
      return v.value;
    case "bool":
      return v.value;
    case "none":
      return null;
    default:
      throw new Error(`unhandled tag: ${v.tag}`);
  }
}

describe("Richer lattice specialization — comparison fast path", () => {
  test("int less-than: 3 < 5 = true", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x < y\nf(3, 5)")).toBe(true);
  });

  test("int less-than: 5 < 3 = false", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x < y\nf(5, 3)")).toBe(false);
  });

  test("int greater-than: 5 > 3 = true", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x > y\nf(5, 3)")).toBe(true);
  });

  test("int equal: 4 == 4 = true", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x == y\nf(4, 4)")).toBe(true);
  });

  test("int equal: 4 == 5 = false", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x == y\nf(4, 5)")).toBe(false);
  });

  test("int not-equal: 4 != 5 = true", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x != y\nf(4, 5)")).toBe(true);
  });

  test("int lte: 3 <= 3 = true", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x <= y\nf(3, 3)")).toBe(true);
  });

  test("int gte: 5 >= 3 = true", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x >= y\nf(5, 3)")).toBe(true);
  });
});

describe("Richer lattice specialization — floor-mod correctness", () => {
  // IMPORTANT: These tests verify Python floor-mod semantics (result sign = divisor sign).
  // The SVML interpreter uses truncated mod (-7 % 3 = -1 in SVML); these tests only apply
  // to the WasmJIT path where BuilderGenerator emits GENERIC_FLOOR_MOD_FX.
  test("modulo positive operands: 7 % 3 = 1", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x % y\nf(7, 3)")).toBe(1);
  });

  test("modulo negative dividend: -7 % 3 = 2 (Python floor-mod)", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x % y\nf(-7, 3)")).toBe(2);
  });

  test("modulo negative divisor: 7 % -3 = -2 (Python floor-mod)", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x % y\nf(7, -3)")).toBe(-2);
  });

  test("modulo both negative: -7 % -3 = -1 (Python floor-mod)", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x % y\nf(-7, -3)")).toBe(-1);
  });

  test("modulo exact division: 9 % 3 = 0", async () => {
    expect(await runJITWasm("def f(x, y):\n  return x % y\nf(9, 3)")).toBe(0);
  });
});

describe("Richer lattice specialization — unary fast paths", () => {
  test("NOT True = False", async () => {
    expect(await runJITWasm("def f(x):\n  return not x\nf(True)")).toBe(false);
  });

  test("NOT False = True", async () => {
    expect(await runJITWasm("def f(x):\n  return not x\nf(False)")).toBe(true);
  });

  test("NEG positive int: -5 = -5", async () => {
    expect(await runJITWasm("def f(x):\n  return -x\nf(5)")).toBe(-5);
  });

  test("NEG negative int: -(-3) = 3", async () => {
    expect(await runJITWasm("def f(x):\n  return -x\nf(-3)")).toBe(3);
  });

  test("NEG zero: -(0) = 0", async () => {
    expect(await runJITWasm("def f(x):\n  return -x\nf(0)")).toBe(0);
  });
});
