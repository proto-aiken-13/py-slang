import { TYPE_TAG } from "./constants";
import {
  integer, boolean as boolVal, stringValue, nullValue, closureValue, TOP,
} from "../types/lattice-ops";
import type { AbstractValue } from "../types/abstract-value";
import type { FunctionProfile } from "../specialization/types";

/** Maximum number of parameters tracked per function. */
export const MAX_PARAMS_TRACKED = 8;

/**
 * Sentinel byte value written to every byte of the observation buffer by memory.fill.
 * When all 4 bytes of a word are 0xFF, the Uint32 word value is SENTINEL_WORD.
 */
export const PROFILING_SENTINEL = 0xFF;

/** Uint32 word value of an uninitialised cell (4 × PROFILING_SENTINEL bytes). */
const SENTINEL_WORD = 0xFFFFFFFF;

/**
 * Convert a Wasm TYPE_TAG integer to an AbstractValue for profiling purposes.
 * Returns null for types with no lattice representation (COMPLEX, PAIR, UNBOUND).
 */
export function tagToAbstractValue(tag: number): AbstractValue | null {
  switch (tag) {
    case TYPE_TAG.INT:     return integer();
    case TYPE_TAG.FLOAT:   return TOP;
    case TYPE_TAG.BOOL:    return boolVal();
    case TYPE_TAG.STRING:  return stringValue();
    case TYPE_TAG.NONE:    return nullValue();
    case TYPE_TAG.CLOSURE: return closureValue();
    default:               return null;
  }
}

/**
 * Decode the profiling observation buffer from Wasm linear memory.
 *
 * @param memory            The WebAssembly.Memory from the executed module.
 * @param profilingBase     Byte offset where the observation buffer starts.
 * @param numFunctions      Number of user-defined functions tracked.
 * @param funcArities       Arity of each function at its userFunctions index.
 * @param maxParamsTracked  MAX_PARAMS_TRACKED constant used during codegen.
 * @returns                 Map from function index → FunctionProfile[].
 *                          Only functions that were observed (at least one
 *                          cell with a recognized type tag) appear as keys.
 *                          Tags like COMPLEX/PAIR/UNBOUND are silently dropped
 *                          even if non-sentinel.
 */
export function decodeObservations(
  memory: WebAssembly.Memory,
  profilingBase: number,
  numFunctions: number,
  funcArities: number[],
  maxParamsTracked: number,
): Map<number, FunctionProfile[]> {
  // Uint32Array so that 0xFFFFFFFF sentinel words compare correctly.
  // (memory.fill writes byte 0xFF into every byte; as Int32 that would be -1,
  //  which does not equal PROFILING_SENTINEL = 255.)
  const view = new Uint32Array(memory.buffer);
  const result = new Map<number, FunctionProfile[]>();

  for (let fi = 0; fi < numFunctions; fi++) {
    const profile = new Map<number, AbstractValue>();
    let anyObserved = false;
    const arity = Math.min(funcArities[fi] ?? 0, maxParamsTracked);

    for (let pi = 0; pi < arity; pi++) {
      const byteOffset = profilingBase + (fi * maxParamsTracked + pi) * 4;
      const wordIndex = byteOffset >> 2;
      const rawTag = view[wordIndex];

      if (rawTag !== SENTINEL_WORD) {
        const av = tagToAbstractValue(rawTag);
        if (av !== null) {
          profile.set(pi, av);
          anyObserved = true;
        }
      }
    }

    if (anyObserved) {
      result.set(fi, [profile]);
    }
  }

  return result;
}
