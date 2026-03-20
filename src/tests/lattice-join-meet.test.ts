/**
 * Comprehensive unit tests for lattice join/meet operations using the
 * NEW bitmask representation (IntRef, BoolRef, SoundType.kinds).
 *
 * Join = bitwise OR, Meet = bitwise AND for both IntRef and BoolRef.
 */

import {
  IntRef,
  BoolRef,
  INT_BIT,
  BOOL_BIT,
  STR_BIT,
  ALL_KINDS_MASK,
} from "../types/abstract-value";
import {
  joinIntRef,
  meetIntRef,
  leqIntRef,
  joinBoolRef,
  meetBoolRef,
  join,
  meet,
  leq,
  integer,
  positiveInteger,
  negativeInteger,
  zeroInteger,
  boolean,
  trueValue,
  falseValue,
  stringValue,
  nullValue,
  closureValue,
  TOP,
  BOTTOM,
} from "../types/lattice-ops";
import { negSign } from "../specialization/transfer";

// ---------------------------------------------------------------------------
// Helpers: enumerate all lattice elements
// ---------------------------------------------------------------------------

const ALL_INT_REFS: IntRef[] = [
  IntRef.Bottom,  // 0
  IntRef.Neg,     // 1
  IntRef.Zero,    // 2
  IntRef.NonPos,  // 3  (Neg | Zero)
  IntRef.Pos,     // 4
  IntRef.NonZero, // 5  (Neg | Pos)
  IntRef.NonNeg,  // 6  (Zero | Pos)
  IntRef.Top,     // 7  (Neg | Zero | Pos)
];

const ALL_BOOL_REFS: BoolRef[] = [
  BoolRef.Bottom, // 0
  BoolRef.True,   // 1
  BoolRef.False,  // 2
  BoolRef.Top,    // 3
];

/** Human-readable label for IntRef values */
function intLabel(v: IntRef): string {
  const names: Record<number, string> = {
    [IntRef.Bottom]: "Bottom",
    [IntRef.Neg]: "Neg",
    [IntRef.Zero]: "Zero",
    [IntRef.NonPos]: "NonPos",
    [IntRef.Pos]: "Pos",
    [IntRef.NonZero]: "NonZero",
    [IntRef.NonNeg]: "NonNeg",
    [IntRef.Top]: "Top",
  };
  return names[v] ?? `IntRef(${v})`;
}

/** Human-readable label for BoolRef values */
function boolLabel(v: BoolRef): string {
  const names: Record<number, string> = {
    [BoolRef.Bottom]: "Bottom",
    [BoolRef.True]: "True",
    [BoolRef.False]: "False",
    [BoolRef.Top]: "Top",
  };
  return names[v] ?? `BoolRef(${v})`;
}

// Pre-compute all pairs
const INT_PAIRS: Array<[IntRef, IntRef]> = ALL_INT_REFS.flatMap((a) =>
  ALL_INT_REFS.map((b) => [a, b] as [IntRef, IntRef]),
);

const BOOL_PAIRS: Array<[BoolRef, BoolRef]> = ALL_BOOL_REFS.flatMap((a) =>
  ALL_BOOL_REFS.map((b) => [a, b] as [BoolRef, BoolRef]),
);

const INT_TRIPLES: Array<[IntRef, IntRef, IntRef]> = ALL_INT_REFS.flatMap((a) =>
  ALL_INT_REFS.flatMap((b) =>
    ALL_INT_REFS.map((c) => [a, b, c] as [IntRef, IntRef, IntRef]),
  ),
);

const BOOL_TRIPLES: Array<[BoolRef, BoolRef, BoolRef]> = ALL_BOOL_REFS.flatMap(
  (a) =>
    ALL_BOOL_REFS.flatMap((b) =>
      ALL_BOOL_REFS.map((c) => [a, b, c] as [BoolRef, BoolRef, BoolRef]),
    ),
);

// ===================================================================
// 1. IntRef join = OR (all 64 pairs)
// ===================================================================

describe("IntRef join = bitwise OR (all 64 pairs)", () => {
  test.each(INT_PAIRS)(
    "joinIntRef(%i, %i) === %i | %i",
    (a, b) => {
      expect(joinIntRef(a, b)).toBe((a | b) as IntRef);
    },
  );
});

// ===================================================================
// 2. IntRef meet = AND (all 64 pairs)
// ===================================================================

describe("IntRef meet = bitwise AND (all 64 pairs)", () => {
  test.each(INT_PAIRS)(
    "meetIntRef(%i, %i) === %i & %i",
    (a, b) => {
      expect(meetIntRef(a, b)).toBe((a & b) as IntRef);
    },
  );
});

// ===================================================================
// 3. BoolRef join = OR (all 16 pairs)
// ===================================================================

describe("BoolRef join = bitwise OR (all 16 pairs)", () => {
  test.each(BOOL_PAIRS)(
    "joinBoolRef(%i, %i) === %i | %i",
    (a, b) => {
      expect(joinBoolRef(a, b)).toBe((a | b) as BoolRef);
    },
  );
});

// ===================================================================
// 4. BoolRef meet = AND (all 16 pairs)
// ===================================================================

describe("BoolRef meet = bitwise AND (all 16 pairs)", () => {
  test.each(BOOL_PAIRS)(
    "meetBoolRef(%i, %i) === %i & %i",
    (a, b) => {
      expect(meetBoolRef(a, b)).toBe((a & b) as BoolRef);
    },
  );
});

// ===================================================================
// 5. Lattice algebraic properties
// ===================================================================

describe("IntRef lattice algebraic properties", () => {
  // Commutativity
  describe("commutativity", () => {
    test.each(INT_PAIRS)(
      "joinIntRef(%i, %i) === joinIntRef(%i, %i) [commutative join]",
      (a, b) => {
        expect(joinIntRef(a, b)).toBe(joinIntRef(b, a));
      },
    );

    test.each(INT_PAIRS)(
      "meetIntRef(%i, %i) === meetIntRef(%i, %i) [commutative meet]",
      (a, b) => {
        expect(meetIntRef(a, b)).toBe(meetIntRef(b, a));
      },
    );
  });

  // Associativity
  describe("associativity", () => {
    test.each(INT_TRIPLES)(
      "joinIntRef(joinIntRef(%i,%i),%i) === joinIntRef(%i,joinIntRef(%i,%i))",
      (a, b, c) => {
        expect(joinIntRef(joinIntRef(a, b), c)).toBe(
          joinIntRef(a, joinIntRef(b, c)),
        );
      },
    );

    test.each(INT_TRIPLES)(
      "meetIntRef(meetIntRef(%i,%i),%i) === meetIntRef(%i,meetIntRef(%i,%i))",
      (a, b, c) => {
        expect(meetIntRef(meetIntRef(a, b), c)).toBe(
          meetIntRef(a, meetIntRef(b, c)),
        );
      },
    );
  });

  // Idempotent
  describe("idempotent", () => {
    test.each(ALL_INT_REFS)("joinIntRef(%i, %i) === %i", (a) => {
      expect(joinIntRef(a, a)).toBe(a);
    });

    test.each(ALL_INT_REFS)("meetIntRef(%i, %i) === %i", (a) => {
      expect(meetIntRef(a, a)).toBe(a);
    });
  });

  // Absorption
  describe("absorption", () => {
    test.each(INT_PAIRS)(
      "joinIntRef(%i, meetIntRef(%i, %i)) === %i [absorption]",
      (a, b) => {
        expect(joinIntRef(a, meetIntRef(a, b))).toBe(a);
      },
    );

    test.each(INT_PAIRS)(
      "meetIntRef(%i, joinIntRef(%i, %i)) === %i [absorption]",
      (a, b) => {
        expect(meetIntRef(a, joinIntRef(a, b))).toBe(a);
      },
    );
  });

  // Identity
  describe("identity", () => {
    test.each(ALL_INT_REFS)(
      "joinIntRef(%i, Bottom) === %i [join identity]",
      (a) => {
        expect(joinIntRef(a, IntRef.Bottom)).toBe(a);
      },
    );

    test.each(ALL_INT_REFS)(
      "meetIntRef(%i, Top) === %i [meet identity]",
      (a) => {
        expect(meetIntRef(a, IntRef.Top)).toBe(a);
      },
    );
  });

  // Annihilator
  describe("annihilator", () => {
    test.each(ALL_INT_REFS)(
      "joinIntRef(%i, Top) === Top [join annihilator]",
      (a) => {
        expect(joinIntRef(a, IntRef.Top)).toBe(IntRef.Top);
      },
    );

    test.each(ALL_INT_REFS)(
      "meetIntRef(%i, Bottom) === Bottom [meet annihilator]",
      (a) => {
        expect(meetIntRef(a, IntRef.Bottom)).toBe(IntRef.Bottom);
      },
    );
  });
});

describe("BoolRef lattice algebraic properties", () => {
  // Commutativity
  describe("commutativity", () => {
    test.each(BOOL_PAIRS)(
      "joinBoolRef(%i, %i) [commutative]",
      (a, b) => {
        expect(joinBoolRef(a, b)).toBe(joinBoolRef(b, a));
      },
    );

    test.each(BOOL_PAIRS)(
      "meetBoolRef(%i, %i) [commutative]",
      (a, b) => {
        expect(meetBoolRef(a, b)).toBe(meetBoolRef(b, a));
      },
    );
  });

  // Associativity
  describe("associativity", () => {
    test.each(BOOL_TRIPLES)(
      "joinBoolRef associative (%i, %i, %i)",
      (a, b, c) => {
        expect(joinBoolRef(joinBoolRef(a, b), c)).toBe(
          joinBoolRef(a, joinBoolRef(b, c)),
        );
      },
    );

    test.each(BOOL_TRIPLES)(
      "meetBoolRef associative (%i, %i, %i)",
      (a, b, c) => {
        expect(meetBoolRef(meetBoolRef(a, b), c)).toBe(
          meetBoolRef(a, meetBoolRef(b, c)),
        );
      },
    );
  });

  // Idempotent
  describe("idempotent", () => {
    test.each(ALL_BOOL_REFS)("joinBoolRef(%i, %i) === %i", (a) => {
      expect(joinBoolRef(a, a)).toBe(a);
    });

    test.each(ALL_BOOL_REFS)("meetBoolRef(%i, %i) === %i", (a) => {
      expect(meetBoolRef(a, a)).toBe(a);
    });
  });

  // Absorption
  describe("absorption", () => {
    test.each(BOOL_PAIRS)(
      "joinBoolRef(%i, meetBoolRef(%i, %i)) === %i",
      (a, b) => {
        expect(joinBoolRef(a, meetBoolRef(a, b))).toBe(a);
      },
    );

    test.each(BOOL_PAIRS)(
      "meetBoolRef(%i, joinBoolRef(%i, %i)) === %i",
      (a, b) => {
        expect(meetBoolRef(a, joinBoolRef(a, b))).toBe(a);
      },
    );
  });

  // Identity
  describe("identity", () => {
    test.each(ALL_BOOL_REFS)(
      "joinBoolRef(%i, Bottom) === %i",
      (a) => {
        expect(joinBoolRef(a, BoolRef.Bottom)).toBe(a);
      },
    );

    test.each(ALL_BOOL_REFS)(
      "meetBoolRef(%i, Top) === %i",
      (a) => {
        expect(meetBoolRef(a, BoolRef.Top)).toBe(a);
      },
    );
  });

  // Annihilator
  describe("annihilator", () => {
    test.each(ALL_BOOL_REFS)(
      "joinBoolRef(%i, Top) === Top",
      (a) => {
        expect(joinBoolRef(a, BoolRef.Top)).toBe(BoolRef.Top);
      },
    );

    test.each(ALL_BOOL_REFS)(
      "meetBoolRef(%i, Bottom) === Bottom",
      (a) => {
        expect(meetBoolRef(a, BoolRef.Bottom)).toBe(BoolRef.Bottom);
      },
    );
  });
});

// ===================================================================
// 6. leq properties: leq(a,b) iff join(a,b)===b iff meet(a,b)===a
// ===================================================================

describe("IntRef leq consistency with join and meet", () => {
  test.each(INT_PAIRS)(
    "leqIntRef(%i, %i) iff joinIntRef(%i,%i)===%i iff meetIntRef(%i,%i)===%i",
    (a, b) => {
      const le = leqIntRef(a, b);
      const joinEq = joinIntRef(a, b) === b;
      const meetEq = meetIntRef(a, b) === a;
      expect(le).toBe(joinEq);
      expect(le).toBe(meetEq);
    },
  );

  // Specific structural checks
  test("Bottom <= everything", () => {
    for (const x of ALL_INT_REFS) {
      expect(leqIntRef(IntRef.Bottom, x)).toBe(true);
    }
  });

  test("everything <= Top", () => {
    for (const x of ALL_INT_REFS) {
      expect(leqIntRef(x, IntRef.Top)).toBe(true);
    }
  });

  test("Neg <= NonZero", () => {
    expect(leqIntRef(IntRef.Neg, IntRef.NonZero)).toBe(true);
  });

  test("Pos <= NonNeg", () => {
    expect(leqIntRef(IntRef.Pos, IntRef.NonNeg)).toBe(true);
  });

  test("Pos NOT <= Neg", () => {
    expect(leqIntRef(IntRef.Pos, IntRef.Neg)).toBe(false);
  });

  test("Top NOT <= Pos", () => {
    expect(leqIntRef(IntRef.Top, IntRef.Pos)).toBe(false);
  });
});

// ===================================================================
// 7. AbstractValue join
// ===================================================================

describe("AbstractValue join", () => {
  test("identity short-circuit: join(posInt, posInt) returns same reference", () => {
    const posInt = positiveInteger();
    const result = join(posInt, posInt);
    expect(result).toBe(posInt); // strict reference equality
  });

  test("identity short-circuit: join(TOP, TOP) returns same reference", () => {
    expect(join(TOP, TOP)).toBe(TOP);
  });

  test("identity short-circuit: join(BOTTOM, BOTTOM) returns same reference", () => {
    expect(join(BOTTOM, BOTTOM)).toBe(BOTTOM);
  });

  test("join(posInt, negInt) produces NonZero int", () => {
    const result = join(positiveInteger(), negativeInteger());
    expect(result.sound.intRef).toBe(IntRef.NonZero);
    expect(result.sound.kinds & INT_BIT).toBeTruthy();
  });

  test("join(posInt, zeroInt) produces NonNeg int", () => {
    const result = join(positiveInteger(), zeroInteger());
    expect(result.sound.intRef).toBe(IntRef.NonNeg);
    expect(result.sound.kinds & INT_BIT).toBeTruthy();
  });

  test("join(trueValue, falseValue) produces Top bool", () => {
    const result = join(trueValue(), falseValue());
    expect(result.sound.boolRef).toBe(BoolRef.Top);
    expect(result.sound.kinds & BOOL_BIT).toBeTruthy();
  });

  test("mixed-kind join: int and bool gives INT_BIT | BOOL_BIT", () => {
    const result = join(positiveInteger(), trueValue());
    expect(result.sound.kinds & INT_BIT).toBeTruthy();
    expect(result.sound.kinds & BOOL_BIT).toBeTruthy();
    expect(result.sound.intRef).toBe(IntRef.Pos);
    expect(result.sound.boolRef).toBe(BoolRef.True);
  });

  test("mixed-kind join: int and string gives INT_BIT | STR_BIT", () => {
    const result = join(integer(), stringValue());
    expect(result.sound.kinds & INT_BIT).toBeTruthy();
    expect(result.sound.kinds & STR_BIT).toBeTruthy();
  });

  test("join(a, BOTTOM) === a (identity)", () => {
    const v = positiveInteger();
    expect(join(v, BOTTOM)).toEqual(v);
  });

  test("join(BOTTOM, a) === a (identity, reversed)", () => {
    const v = trueValue();
    expect(join(BOTTOM, v)).toEqual(v);
  });

  test("join(a, TOP) === TOP (annihilator)", () => {
    expect(join(positiveInteger(), TOP)).toEqual(TOP);
  });

  test("join(TOP, a) === TOP (annihilator, reversed)", () => {
    expect(join(TOP, nullValue())).toEqual(TOP);
  });

  test("join is commutative for mixed-kind values", () => {
    const a = positiveInteger();
    const b = trueValue();
    const ab = join(a, b);
    const ba = join(b, a);
    expect(ab.sound.kinds).toBe(ba.sound.kinds);
    expect(ab.sound.intRef).toBe(ba.sound.intRef);
    expect(ab.sound.boolRef).toBe(ba.sound.boolRef);
  });

  test("join is associative for three different kinds", () => {
    const a = positiveInteger();
    const b = trueValue();
    const c = stringValue();
    const lhs = join(join(a, b), c);
    const rhs = join(a, join(b, c));
    expect(lhs.sound.kinds).toBe(rhs.sound.kinds);
    expect(lhs.sound.intRef).toBe(rhs.sound.intRef);
    expect(lhs.sound.boolRef).toBe(rhs.sound.boolRef);
  });
});

describe("AbstractValue meet", () => {
  test("meet(a, TOP) === a", () => {
    const v = positiveInteger();
    expect(meet(v, TOP)).toEqual(v);
  });

  test("meet(a, BOTTOM) === BOTTOM", () => {
    expect(meet(integer(), BOTTOM)).toEqual(BOTTOM);
  });

  test("meet(int|null, int) = int", () => {
    const intOrNull = join(integer(), nullValue());
    const result = meet(intOrNull, integer());
    expect(result.sound.kinds & INT_BIT).toBeTruthy();
    expect(result.sound.intRef).toBe(IntRef.Top);
  });

  test("meet is commutative", () => {
    const a = join(integer(), nullValue());
    const b = join(integer(), stringValue());
    const ab = meet(a, b);
    const ba = meet(b, a);
    expect(ab.sound.kinds).toBe(ba.sound.kinds);
    expect(ab.sound.intRef).toBe(ba.sound.intRef);
    expect(ab.sound.boolRef).toBe(ba.sound.boolRef);
  });
});

describe("AbstractValue leq", () => {
  test("BOTTOM <= anything", () => {
    expect(leq(BOTTOM, integer())).toBe(true);
    expect(leq(BOTTOM, TOP)).toBe(true);
    expect(leq(BOTTOM, BOTTOM)).toBe(true);
  });

  test("anything <= TOP", () => {
    expect(leq(integer(), TOP)).toBe(true);
    expect(leq(BOTTOM, TOP)).toBe(true);
    expect(leq(TOP, TOP)).toBe(true);
  });

  test("posInt <= integer", () => {
    expect(leq(positiveInteger(), integer())).toBe(true);
  });

  test("integer NOT <= posInt", () => {
    expect(leq(integer(), positiveInteger())).toBe(false);
  });

  test("trueValue <= boolean", () => {
    expect(leq(trueValue(), boolean())).toBe(true);
  });

  test("leq consistent with join: leq(a,b) iff join(a,b) deepEqual b", () => {
    const pairs = [
      [positiveInteger(), integer()],
      [trueValue(), boolean()],
      [BOTTOM, nullValue()],
      [stringValue(), TOP],
    ] as const;
    for (const [a, b] of pairs) {
      const le = leq(a, b);
      const j = join(a, b);
      // If a <= b, then join(a,b) should equal b
      if (le) {
        expect(j.sound.kinds).toBe(b.sound.kinds);
        expect(j.sound.intRef).toBe(b.sound.intRef);
        expect(j.sound.boolRef).toBe(b.sound.boolRef);
      }
    }
  });
});

// ===================================================================
// 8. Singleton integrity
// ===================================================================

describe("Singleton integrity", () => {
  test("positiveInteger() returns the same frozen object each time", () => {
    const a = positiveInteger();
    const b = positiveInteger();
    expect(a).toBe(b); // reference equality
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("negativeInteger() returns the same frozen object each time", () => {
    const a = negativeInteger();
    const b = negativeInteger();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("zeroInteger() returns the same frozen object each time", () => {
    const a = zeroInteger();
    const b = zeroInteger();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("integer() returns the same frozen object each time", () => {
    const a = integer();
    const b = integer();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("trueValue() returns the same frozen object each time", () => {
    const a = trueValue();
    const b = trueValue();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("falseValue() returns the same frozen object each time", () => {
    const a = falseValue();
    const b = falseValue();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("boolean() returns the same frozen object each time", () => {
    const a = boolean();
    const b = boolean();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("stringValue() returns the same frozen object each time", () => {
    const a = stringValue();
    const b = stringValue();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("nullValue() returns the same frozen object each time", () => {
    const a = nullValue();
    const b = nullValue();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("closureValue() returns the same frozen object each time", () => {
    const a = closureValue();
    const b = closureValue();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("TOP is frozen", () => {
    expect(Object.isFrozen(TOP)).toBe(true);
  });

  test("BOTTOM is frozen", () => {
    expect(Object.isFrozen(BOTTOM)).toBe(true);
  });

  test("frozen singletons cannot be mutated", () => {
    const v = positiveInteger();
    expect(() => {
      (v as any).sound = {};
    }).toThrow();
  });
});

// ===================================================================
// 9. negSign correctness (bit-swap formula for all 8 IntRef values)
// ===================================================================

describe("negSign correctness", () => {
  // negSign swaps Neg (bit 0) and Pos (bit 2), leaving Zero (bit 1) unchanged.
  // Formula: swap bits 0 and 2. For a 3-bit value [b2 b1 b0]:
  //   result = (b0 << 2) | b1 | (b2 >> 2)
  // Equivalently: swap the Neg and Pos bits.

  const NEG_SIGN_TABLE: Array<[IntRef, IntRef]> = [
    [IntRef.Bottom, IntRef.Bottom],   // 0 -> 0
    [IntRef.Neg, IntRef.Pos],         // 1 -> 4
    [IntRef.Zero, IntRef.Zero],       // 2 -> 2
    [IntRef.NonPos, IntRef.NonNeg],   // 3 (Neg|Zero) -> 6 (Pos|Zero)
    [IntRef.Pos, IntRef.Neg],         // 4 -> 1
    [IntRef.NonZero, IntRef.NonZero], // 5 (Neg|Pos) -> 5 (Pos|Neg)
    [IntRef.NonNeg, IntRef.NonPos],   // 6 (Zero|Pos) -> 3 (Zero|Neg)
    [IntRef.Top, IntRef.Top],         // 7 -> 7
  ];

  test.each(NEG_SIGN_TABLE)(
    "negSign(%i) === %i",
    (input, expected) => {
      expect(negSign(input)).toBe(expected);
    },
  );

  // Self-inverse property
  test.each(ALL_INT_REFS)("negSign(negSign(%i)) === %i [involution]", (a) => {
    expect(negSign(negSign(a))).toBe(a);
  });

  // negSign preserves Bottom and Top
  test("negSign(Bottom) === Bottom", () => {
    expect(negSign(IntRef.Bottom)).toBe(IntRef.Bottom);
  });

  test("negSign(Top) === Top", () => {
    expect(negSign(IntRef.Top)).toBe(IntRef.Top);
  });

  // negSign preserves Zero
  test("negSign(Zero) === Zero", () => {
    expect(negSign(IntRef.Zero)).toBe(IntRef.Zero);
  });

  // negSign preserves NonZero
  test("negSign(NonZero) === NonZero", () => {
    expect(negSign(IntRef.NonZero)).toBe(IntRef.NonZero);
  });
});
