import { SVMLAdapter } from "../vm/svml-adapter";
import type { SVMLArray, SVMLClosure } from "../vm/types";
import { INT_BIT, BOOL_BIT, STR_BIT, NULL_BIT, CLOSURE_BIT, ALL_KINDS_MASK, IntRef, BoolRef } from "../types/abstract-value";

describe("SVMLAdapter", () => {
  let adapter: SVMLAdapter;

  beforeEach(() => {
    adapter = new SVMLAdapter();
  });

  describe("toPython", () => {
    test("number maps to int", () => {
      expect(adapter.toPython(42)).toEqual({ tag: "int", value: 42 });
    });

    test("boolean maps to bool", () => {
      expect(adapter.toPython(true)).toEqual({ tag: "bool", value: true });
      expect(adapter.toPython(false)).toEqual({ tag: "bool", value: false });
    });

    test("string maps to str", () => {
      expect(adapter.toPython("hello")).toEqual({ tag: "str", value: "hello" });
    });

    test("null maps to none", () => {
      expect(adapter.toPython(null)).toEqual({ tag: "none" });
    });

    test("undefined maps to none", () => {
      expect(adapter.toPython(undefined)).toEqual({ tag: "none" });
    });

    test("closure maps to function", () => {
      const closure: SVMLClosure = {
        type: "closure",
        functionIndex: 0,
        parentEnv: null,
      };
      expect(adapter.toPython(closure)).toEqual({
        tag: "function",
        name: "<closure>",
        arity: 0,
      });
    });

    test("array maps to list", () => {
      const arr: SVMLArray = { type: "array", elements: [1, 2, 3] };
      expect(adapter.toPython(arr)).toEqual({
        tag: "list",
        elements: [
          { tag: "int", value: 1 },
          { tag: "int", value: 2 },
          { tag: "int", value: 3 },
        ],
      });
    });
  });

  describe("toAbstractValue", () => {
    test("positive int maps to pos refinement", () => {
      const av = adapter.toAbstractValue({ tag: "int", value: 5 });
      expect(av.sound.kinds).toBe(INT_BIT);
      expect(av.sound.intRef).toBe(IntRef.Pos);
    });

    test("negative int maps to neg refinement", () => {
      const av = adapter.toAbstractValue({ tag: "int", value: -3 });
      expect(av.sound.kinds).toBe(INT_BIT);
      expect(av.sound.intRef).toBe(IntRef.Neg);
    });

    test("zero maps to zero refinement", () => {
      const av = adapter.toAbstractValue({ tag: "int", value: 0 });
      expect(av.sound.kinds).toBe(INT_BIT);
      expect(av.sound.intRef).toBe(IntRef.Zero);
    });

    test("true maps to true bool refinement", () => {
      const av = adapter.toAbstractValue({ tag: "bool", value: true });
      expect(av.sound.kinds).toBe(BOOL_BIT);
      expect(av.sound.boolRef).toBe(BoolRef.True);
    });

    test("false maps to false bool refinement", () => {
      const av = adapter.toAbstractValue({ tag: "bool", value: false });
      expect(av.sound.kinds).toBe(BOOL_BIT);
      expect(av.sound.boolRef).toBe(BoolRef.False);
    });

    test("none maps to null kind", () => {
      const av = adapter.toAbstractValue({ tag: "none" });
      expect(av.sound.kinds).toBe(NULL_BIT);
    });

    test("str maps to str kind", () => {
      const av = adapter.toAbstractValue({ tag: "str", value: "hi" });
      expect(av.sound.kinds).toBe(STR_BIT);
    });

    test("function maps to closure kind", () => {
      const av = adapter.toAbstractValue({ tag: "function", name: "f", arity: 1 });
      expect(av.sound.kinds).toBe(CLOSURE_BIT);
    });

    test("list maps to TOP", () => {
      const av = adapter.toAbstractValue({ tag: "list", elements: [] });
      expect(av.sound.kinds).toBe(ALL_KINDS_MASK);
      expect(av.sound.intRef).toBe(IntRef.Top);
      expect(av.sound.boolRef).toBe(BoolRef.Top);
    });
  });
});
