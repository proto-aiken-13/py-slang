import {
  FLOAT_BIT,
  COMPLEX_BIT,
  ALL_KINDS_MASK,
  INT_BIT,
  BOOL_BIT,
  STR_BIT,
  NULL_BIT,
  CLOSURE_BIT,
  IntRef,
} from "../types/abstract-value";
import {
  floatValue,
  positiveFloat,
  negativeFloat,
  zeroFloat,
  complexValue,
  join,
  meet,
  leq,
  TOP,
  BOTTOM,
  integer,
  positiveInteger,
} from "../types/lattice-ops";

describe("Float lattice", () => {
  test("FLOAT_BIT is distinct from all other bits", () => {
    const others = [INT_BIT, BOOL_BIT, STR_BIT, NULL_BIT, CLOSURE_BIT, COMPLEX_BIT];
    for (const other of others) {
      expect(FLOAT_BIT & other).toBe(0);
    }
  });

  test("ALL_KINDS_MASK includes FLOAT_BIT and COMPLEX_BIT", () => {
    expect(ALL_KINDS_MASK & FLOAT_BIT).toBe(FLOAT_BIT);
    expect(ALL_KINDS_MASK & COMPLEX_BIT).toBe(COMPLEX_BIT);
  });

  test("floatValue() has FLOAT_BIT kind", () => {
    const fv = floatValue();
    expect(fv.sound.kinds).toBe(FLOAT_BIT);
  });

  test("positiveFloat() has Pos floatRef", () => {
    const pf = positiveFloat();
    expect(pf.sound.kinds).toBe(FLOAT_BIT);
    expect(pf.sound.floatRef).toBe(IntRef.Pos);
  });

  test("negativeFloat() has Neg floatRef", () => {
    const nf = negativeFloat();
    expect(nf.sound.kinds).toBe(FLOAT_BIT);
    expect(nf.sound.floatRef).toBe(IntRef.Neg);
  });

  test("zeroFloat() has Zero floatRef", () => {
    const zf = zeroFloat();
    expect(zf.sound.kinds).toBe(FLOAT_BIT);
    expect(zf.sound.floatRef).toBe(IntRef.Zero);
  });

  test("join(positiveFloat, negativeFloat) has NonZero floatRef", () => {
    const result = join(positiveFloat(), negativeFloat());
    expect(result.sound.kinds).toBe(FLOAT_BIT);
    expect(result.sound.floatRef).toBe(IntRef.NonZero);
  });

  test("join(int, float) has both kinds", () => {
    const result = join(positiveInteger(), positiveFloat());
    expect(result.sound.kinds & INT_BIT).toBeTruthy();
    expect(result.sound.kinds & FLOAT_BIT).toBeTruthy();
  });

  test("meet(int, float) = BOTTOM (disjoint)", () => {
    const result = meet(integer(), floatValue());
    expect(result.sound.kinds).toBe(0);
  });

  test("floatValue <= TOP", () => {
    expect(leq(floatValue(), TOP)).toBe(true);
  });

  test("BOTTOM <= floatValue", () => {
    expect(leq(BOTTOM, floatValue())).toBe(true);
  });
});

describe("Complex lattice", () => {
  test("COMPLEX_BIT is distinct from all other bits", () => {
    const others = [INT_BIT, FLOAT_BIT, BOOL_BIT, STR_BIT, NULL_BIT, CLOSURE_BIT];
    for (const other of others) {
      expect(COMPLEX_BIT & other).toBe(0);
    }
  });

  test("complexValue() has COMPLEX_BIT kind, no refinement", () => {
    const cv = complexValue();
    expect(cv.sound.kinds).toBe(COMPLEX_BIT);
  });

  test("join(complex, int) has both kinds", () => {
    const result = join(complexValue(), integer());
    expect(result.sound.kinds & COMPLEX_BIT).toBeTruthy();
    expect(result.sound.kinds & INT_BIT).toBeTruthy();
  });

  test("complexValue <= TOP", () => {
    expect(leq(complexValue(), TOP)).toBe(true);
  });
});

describe("Singleton integrity (float + complex)", () => {
  test("floatValue() returns same frozen object", () => {
    expect(floatValue()).toBe(floatValue());
    expect(Object.isFrozen(floatValue())).toBe(true);
  });

  test("positiveFloat() returns same frozen object", () => {
    expect(positiveFloat()).toBe(positiveFloat());
    expect(Object.isFrozen(positiveFloat())).toBe(true);
  });

  test("complexValue() returns same frozen object", () => {
    expect(complexValue()).toBe(complexValue());
    expect(Object.isFrozen(complexValue())).toBe(true);
  });
});
