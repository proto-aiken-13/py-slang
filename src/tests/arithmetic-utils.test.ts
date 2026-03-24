/**
 * Tests for shared arithmetic utilities.
 */
import { pythonMod } from "../utils/arithmetic";

describe("pythonMod", () => {
  test("positive mod positive", () => {
    expect(pythonMod(10, 3)).toBe(1);
  });

  test("negative mod positive (Python semantics)", () => {
    // In Python: -10 % 3 == 2 (result has same sign as divisor)
    expect(pythonMod(-10, 3)).toBe(2);
  });

  test("positive mod negative (Python semantics)", () => {
    // In Python: 10 % -3 == -2 (result has same sign as divisor)
    expect(pythonMod(10, -3)).toBe(-2);
  });

  test("negative mod negative", () => {
    // In Python: -10 % -3 == -1
    expect(pythonMod(-10, -3)).toBe(-1);
  });

  test("zero mod anything", () => {
    expect(pythonMod(0, 5)).toBe(0);
  });

  test("exact division", () => {
    expect(pythonMod(9, 3)).toBe(0);
  });

  test("large values", () => {
    expect(pythonMod(1000000, 7)).toBe(1000000 % 7);
  });
});
