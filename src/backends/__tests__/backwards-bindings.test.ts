import { describe, it, expect } from "@jest/globals";
import { BackwardsBindings } from "../backwards-bindings";
import type { SpecializableFunctionNode } from "../../specialization/types";
import type { AbstractValue } from "../../types/abstract-value";
import type { FunctionProfile } from "../../specialization/types";

// Minimal stub for a SpecializableFunctionNode
function makeNode(name: string): SpecializableFunctionNode {
  return { __nodeName: name } as unknown as SpecializableFunctionNode;
}

const stubValue = {} as unknown as AbstractValue;

describe("BackwardsBindings", () => {
  it("resolves registered nodes from numeric observations", () => {
    const b = new BackwardsBindings<number>();
    const n0 = makeNode("foo");
    const n1 = makeNode("bar");
    b.register(n0, 0);
    b.register(n1, 1);

    const profile0: FunctionProfile = new Map([[0, stubValue]]);
    const profile1: FunctionProfile = new Map([
      [0, stubValue],
      [1, stubValue],
    ]);
    const obs: ReadonlyMap<number, FunctionProfile[]> = new Map([
      [0, [profile0]],
      [1, [profile1, profile1]],
    ]);

    const result = b.resolve(obs);
    expect(result.size).toBe(2);
    expect(result.get(n0)).toHaveLength(1);
    expect(result.get(n1)).toHaveLength(2);
  });

  it("silently drops observations for unknown IDs", () => {
    const b = new BackwardsBindings<number>();
    const n = makeNode("only");
    b.register(n, 42);

    const obs: ReadonlyMap<number, FunctionProfile[]> = new Map([
      [42, [new Map()]],
      [99, [new Map()]], // no registration for 99
    ]);

    const result = b.resolve(obs);
    expect(result.size).toBe(1);
    expect(result.has(n)).toBe(true);
  });

  it("throws on duplicate registration for the same ID", () => {
    const b = new BackwardsBindings<number>();
    const n = makeNode("dup");
    b.register(n, 7);
    expect(() => b.register(makeNode("other"), 7)).toThrow(/duplicate registration/i);
  });

  it("returns an empty map when observations are empty", () => {
    const b = new BackwardsBindings<number>();
    b.register(makeNode("x"), 0);
    const result = b.resolve(new Map());
    expect(result.size).toBe(0);
  });

  it("returns an empty map when all observation IDs are unregistered", () => {
    const b = new BackwardsBindings<number>();
    const obs: ReadonlyMap<number, FunctionProfile[]> = new Map([[5, [new Map()]]]);
    const result = b.resolve(obs);
    expect(result.size).toBe(0);
  });

  it("size reflects registration count", () => {
    const b = new BackwardsBindings<number>();
    expect(b.size).toBe(0);
    b.register(makeNode("a"), 1);
    expect(b.size).toBe(1);
    b.register(makeNode("b"), 2);
    expect(b.size).toBe(2);
  });

  it("works with string IDs (generic ID = string variant)", () => {
    const b = new BackwardsBindings<string>();
    const n = makeNode("wasm_fn");
    b.register(n, "my_func");
    const obs: ReadonlyMap<string, FunctionProfile[]> = new Map([
      ["my_func", [new Map([[0, stubValue]])]],
    ]);
    const result = b.resolve(obs);
    expect(result.size).toBe(1);
    expect(result.has(n)).toBe(true);
  });

  it("resolve() can be called multiple times on the same bindings", () => {
    const b = new BackwardsBindings<number>();
    const n = makeNode("fn");
    b.register(n, 3);

    const obs1: ReadonlyMap<number, FunctionProfile[]> = new Map([[3, [new Map()]]]);
    const obs2: ReadonlyMap<number, FunctionProfile[]> = new Map([[3, [new Map(), new Map()]]]);

    const r1 = b.resolve(obs1);
    const r2 = b.resolve(obs2);
    expect(r1.get(n)).toHaveLength(1);
    expect(r2.get(n)).toHaveLength(2);
  });
});
