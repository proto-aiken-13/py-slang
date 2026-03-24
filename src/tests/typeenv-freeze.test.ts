/**
 * Tests that TypeEnv bindings are treated as immutable during specialization.
 */
import { specializeAST } from "../specialization/specialize-ast";
import { positiveInteger } from "../types/lattice-ops";
import type { AbstractValue } from "../types/abstract-value";
import type { SlotInfo } from "../specialization/types";

describe("TypeEnv immutability", () => {
  test("specializeAST does not modify the input bindings map", () => {
    const bindings = new Map<number, AbstractValue>();
    bindings.set(0, positiveInteger());

    const dummyLookup = (): SlotInfo => ({
      slot: 0,
      envLevel: 0,
      isPrimitive: false,
    });

    const originalSize = bindings.size;
    specializeAST([], bindings, dummyLookup);

    // Bindings should not have been modified
    expect(bindings.size).toBe(originalSize);
  });

  test("frozen bindings map does not cause errors in specializeAST", () => {
    const bindings = new Map<number, AbstractValue>();
    bindings.set(0, positiveInteger());

    const dummyLookup = (): SlotInfo => ({
      slot: 0,
      envLevel: 0,
      isPrimitive: false,
    });

    // Freeze to ensure specializeAST tolerates immutable input
    Object.freeze(bindings);

    expect(() => {
      specializeAST([], bindings, dummyLookup);
    }).not.toThrow();
  });
});
