import {
  INT_BIT, FLOAT_BIT, COMPLEX_BIT, BOOL_BIT, STR_BIT, NULL_BIT, CLOSURE_BIT,
} from "../types/abstract-value";
import type { PythonType } from "../types/python-type";

/**
 * Spec types from docs/specs/python_typing.tex:
 *   int, float, complex, bool, str, None, function, list
 *
 * This test ensures PythonType and AbstractValue cover all of them.
 */
describe("Type system coverage", () => {
  const SPEC_TYPES = ["int", "float", "complex", "bool", "str", "none", "function", "list"] as const;

  test("PythonType has a tag for every spec type", () => {
    const values: PythonType[] = [
      { tag: "int", value: 0 },
      { tag: "float", value: 0.0 },
      { tag: "complex", real: 0, imag: 0 },
      { tag: "bool", value: true },
      { tag: "str", value: "" },
      { tag: "none" },
      { tag: "function", name: "f", arity: 0 },
      { tag: "list", elements: [] },
    ];
    const tags = values.map(v => v.tag);
    for (const specType of SPEC_TYPES) {
      expect(tags).toContain(specType);
    }
  });

  // Every numeric/primitive spec type has a lattice bit
  // (list doesn't get its own bit — it maps to TOP, which is intentional)
  test("AbstractValue has a kind bit for int, float, complex, bool, str, None, function", () => {
    const bits = [INT_BIT, FLOAT_BIT, COMPLEX_BIT, BOOL_BIT, STR_BIT, NULL_BIT, CLOSURE_BIT];
    // All bits are distinct (no collisions)
    for (let i = 0; i < bits.length; i++) {
      for (let j = i + 1; j < bits.length; j++) {
        expect(bits[i] & bits[j]).toBe(0);
      }
    }
    // All bits are powers of 2
    for (const bit of bits) {
      expect(bit & (bit - 1)).toBe(0);
      expect(bit).toBeGreaterThan(0);
    }
  });
});
