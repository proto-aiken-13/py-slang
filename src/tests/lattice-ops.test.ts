import {
  TOP,
  BOTTOM,
  integer,
  positiveInteger,
  negativeInteger,
  zeroInteger,
  boolean,
  trueValue,
  falseValue,
  nullValue,
  stringValue,
  closureValue,
  join,
  meet,
  leq,
  IntRef,
  BoolRef,
} from "../types/lattice-ops";
import { INT_BIT, BOOL_BIT, STR_BIT, NULL_BIT, CLOSURE_BIT, ALL_KINDS_MASK } from "../types/abstract-value";

describe("Lattice constructors", () => {
  test("TOP has all kinds", () => {
    expect(TOP.sound.kinds).toBe(ALL_KINDS_MASK);
    expect(TOP.sound.intRef).toBe(IntRef.Top);
    expect(TOP.sound.boolRef).toBe(BoolRef.Top);
  });

  test("BOTTOM has no kinds", () => {
    expect(TOP.sound.kinds).toBe(ALL_KINDS_MASK);
    expect(BOTTOM.sound.kinds).toBe(0);
    expect(BOTTOM.sound.intRef).toBe(IntRef.Bottom);
    expect(BOTTOM.sound.boolRef).toBe(BoolRef.Bottom);
  });

  test("integer() has only int kind", () => {
    const v = integer();
    expect(v.sound.kinds).toBe(INT_BIT);
    expect(v.sound.intRef).toBe(IntRef.Top);
    expect(v.sound.boolRef).toBe(BoolRef.Bottom);
  });

  test("positiveInteger() has pos refinement", () => {
    const v = positiveInteger();
    expect(v.sound.kinds).toBe(INT_BIT);
    expect(v.sound.intRef).toBe(IntRef.Pos);
  });

  test("nullValue() has only null kind", () => {
    const v = nullValue();
    expect(v.sound.kinds).toBe(NULL_BIT);
    expect(v.sound.intRef).toBe(IntRef.Bottom);
    expect(v.sound.boolRef).toBe(BoolRef.Bottom);
  });
});

describe("join", () => {
  test("join(a, a) === a (idempotent)", () => {
    const v = positiveInteger();
    expect(join(v, v)).toEqual(v);
  });

  test("join(a, b) === join(b, a) (commutative)", () => {
    const a = positiveInteger();
    const b = nullValue();
    expect(join(a, b)).toEqual(join(b, a));
  });

  test("join(PositiveInt, Null) = {int, null} with pos refinement", () => {
    const result = join(positiveInteger(), nullValue());
    expect(result.sound.kinds).toBe(INT_BIT | NULL_BIT);
    expect(result.sound.intRef).toBe(IntRef.Pos);
    expect(result.sound.boolRef).toBe(BoolRef.Bottom);
  });

  test("join(True, False) = boolean with top refinement", () => {
    const result = join(trueValue(), falseValue());
    expect(result.sound.kinds).toBe(BOOL_BIT);
    expect(result.sound.boolRef).toBe(BoolRef.Top);
  });

  test("join(a, BOTTOM) === a (identity)", () => {
    const v = integer();
    expect(join(v, BOTTOM)).toEqual(v);
  });

  test("join(a, TOP) === TOP", () => {
    const v = positiveInteger();
    expect(join(v, TOP)).toEqual(TOP);
  });

  test("join(PositiveInt, NegativeInt) = int with nonzero refinement", () => {
    const result = join(positiveInteger(), negativeInteger());
    expect(result.sound.kinds).toBe(INT_BIT);
    expect(result.sound.intRef).toBe(IntRef.NonZero);
  });

  test("join(PositiveInt, ZeroInt) = int with nonneg refinement", () => {
    const result = join(positiveInteger(), zeroInteger());
    expect(result.sound.kinds).toBe(INT_BIT);
    expect(result.sound.intRef).toBe(IntRef.NonNeg);
  });

  test("join is associative", () => {
    const a = positiveInteger();
    const b = nullValue();
    const c = trueValue();
    expect(join(a, join(b, c))).toEqual(join(join(a, b), c));
  });
});

describe("meet", () => {
  test("meet(a, TOP) === a (identity)", () => {
    const v = integer();
    expect(meet(v, TOP)).toEqual(v);
  });

  test("meet(a, BOTTOM) === BOTTOM", () => {
    const v = integer();
    expect(meet(v, BOTTOM)).toEqual(BOTTOM);
  });

  test("meet(Integer?, Integer) = Integer", () => {
    const nullable = join(integer(), nullValue());
    const result = meet(nullable, integer());
    expect(result.sound.kinds).toBe(INT_BIT);
  });
});

describe("leq (partial order)", () => {
  test("BOTTOM <= anything", () => {
    expect(leq(BOTTOM, integer())).toBe(true);
    expect(leq(BOTTOM, TOP)).toBe(true);
  });

  test("anything <= TOP", () => {
    expect(leq(integer(), TOP)).toBe(true);
    expect(leq(BOTTOM, TOP)).toBe(true);
  });

  test("PositiveInteger <= Integer", () => {
    expect(leq(positiveInteger(), integer())).toBe(true);
  });

  test("Integer NOT <= PositiveInteger", () => {
    expect(leq(integer(), positiveInteger())).toBe(false);
  });

  test("True <= Boolean", () => {
    expect(leq(trueValue(), boolean())).toBe(true);
  });
});
