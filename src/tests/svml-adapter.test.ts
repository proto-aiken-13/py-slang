import { SVMLAdapter } from "../backends/svml/svml-adapter";
import type { SVMLArray, SVMLClosure } from "../backends/svml/types";
import {
  INT_BIT,
  BOOL_BIT,
  STR_BIT,
  NULL_BIT,
  CLOSURE_BIT,
  FLOAT_BIT,
  COMPLEX_BIT,
  ALL_KINDS_MASK,
  IntRef,
  BoolRef,
} from "../types/abstract-value";

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

    test("float number maps to float", () => {
      expect(adapter.toPython(3.14)).toEqual({ tag: "float", value: 3.14 });
    });

    test("NaN maps to float", () => {
      expect(adapter.toPython(NaN)).toEqual({ tag: "float", value: NaN });
    });

    test("Infinity maps to float", () => {
      expect(adapter.toPython(Infinity)).toEqual({ tag: "float", value: Infinity });
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

    test("float maps to float kind", () => {
      const av = adapter.toAbstractValue({ tag: "float", value: 3.14 });
      expect(av.sound.kinds).toBe(FLOAT_BIT);
    });

    test("positive float maps to pos float refinement", () => {
      const av = adapter.toAbstractValue({ tag: "float", value: 3.14 });
      expect(av.sound.floatRef).toBe(IntRef.Pos);
    });

    test("NaN float maps to top float refinement", () => {
      const av = adapter.toAbstractValue({ tag: "float", value: NaN });
      expect(av.sound.kinds).toBe(FLOAT_BIT);
      expect(av.sound.floatRef).toBe(IntRef.Top);
    });

    test("complex maps to complex kind", () => {
      const av = adapter.toAbstractValue({ tag: "complex", real: 1, imag: 2 });
      expect(av.sound.kinds).toBe(COMPLEX_BIT);
    });
  });
});
