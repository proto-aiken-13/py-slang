/**
 * Python-compatible modulo operation.
 *
 * In Python, the result of `a % b` has the same sign as `b`,
 * unlike JavaScript where it has the same sign as `a`.
 *
 * Supports both number and bigint operands.
 */
export function pythonMod(a: number | bigint, b: number | bigint): number | bigint {
  if (typeof a === "bigint" || typeof b === "bigint") {
    const big_a = BigInt(a);
    const big_b = BigInt(b);
    const mod = big_a % big_b;

    if ((mod < 0n && big_b > 0n) || (mod > 0n && big_b < 0n)) {
      return mod + big_b;
    } else {
      return mod;
    }
  }
  // both are numbers
  const mod = (a as number) % (b as number);
  if ((mod < 0 && b > 0) || (mod > 0 && b < 0)) {
    return mod + (b as number);
  } else {
    return mod;
  }
}
