import { describe, it, expect } from "@jest/globals";
import { decodeObservations, tagToAbstractValue, MAX_PARAMS_TRACKED } from "../wasm-profiling";
import { TYPE_TAG } from "../constants";
import { INT_BIT, BOOL_BIT, STR_BIT, NULL_BIT } from "../../types/abstract-value";
import { TOP } from "../../types/lattice-ops";

describe("decodeObservations", () => {
  // Uses Uint32Array to match how decodeObservations reads memory.
  // Sentinel cells are set to 0xFFFFFFFF (four 0xFF bytes), which is what
  // Wasm memory.fill(base, 0xFF, size) produces word-wise.
  function makeMemory(profilingBase: number, cells: number[]): WebAssembly.Memory {
    const mem = new WebAssembly.Memory({ initial: 1 });
    const view = new Uint32Array(mem.buffer);
    for (let i = 0; i < cells.length; i++) {
      view[(profilingBase >> 2) + i] = cells[i];
    }
    return mem;
  }

  /** Sentinel word value — equivalent to Wasm memory.fill(base, 0xFF, ...) */
  const SENTINEL = 0xffffffff;

  it("decodes INT tag for param 0 of func 0", () => {
    const base = 65_536 - 1 * MAX_PARAMS_TRACKED * 4; // 1 function
    const cells = new Array(MAX_PARAMS_TRACKED).fill(SENTINEL);
    cells[0] = TYPE_TAG.INT; // func 0, param 0
    const mem = makeMemory(base, cells);

    const result = decodeObservations(mem, base, 1, [1], MAX_PARAMS_TRACKED);
    expect(result.size).toBe(1);
    const profiles = result.get(0)!;
    expect(profiles).toHaveLength(1);
    expect(profiles[0].get(0)!.sound.kinds).toBe(INT_BIT);
  });

  it("treats sentinel cells (0xFFFFFFFF) as not-observed (function absent from output)", () => {
    const base = 65_536 - 1 * MAX_PARAMS_TRACKED * 4;
    const cells = new Array(MAX_PARAMS_TRACKED).fill(SENTINEL);
    const mem = makeMemory(base, cells);

    const result = decodeObservations(mem, base, 1, [1], MAX_PARAMS_TRACKED);
    expect(result.size).toBe(0);
  });

  it("handles two functions with different arities", () => {
    const base = 65_536 - 2 * MAX_PARAMS_TRACKED * 4; // 2 functions
    const cells = new Array(2 * MAX_PARAMS_TRACKED).fill(SENTINEL);
    cells[0] = TYPE_TAG.INT; // func 0, param 0
    cells[MAX_PARAMS_TRACKED + 0] = TYPE_TAG.BOOL; // func 1, param 0
    cells[MAX_PARAMS_TRACKED + 1] = TYPE_TAG.STRING; // func 1, param 1
    const mem = makeMemory(base, cells);

    const result = decodeObservations(mem, base, 2, [1, 2], MAX_PARAMS_TRACKED);
    expect(result.size).toBe(2);
    expect(result.get(0)![0].get(0)!.sound.kinds).toBe(INT_BIT);
    expect(result.get(1)![0].get(0)!.sound.kinds).toBe(BOOL_BIT);
    expect(result.get(1)![0].get(1)!.sound.kinds).toBe(STR_BIT);
  });

  it("cells with unsupported COMPLEX tag are treated as unobserved", () => {
    const base = 65_536 - 1 * MAX_PARAMS_TRACKED * 4;
    const cells = new Array(MAX_PARAMS_TRACKED).fill(SENTINEL);
    cells[0] = TYPE_TAG.COMPLEX;
    const mem = makeMemory(base, cells);

    const result = decodeObservations(mem, base, 1, [1], MAX_PARAMS_TRACKED);
    // COMPLEX has no lattice point — cell is treated as unobserved
    expect(result.size).toBe(0);
  });

  it("tagToAbstractValue maps FLOAT to TOP and NONE to nullValue", () => {
    expect(tagToAbstractValue(TYPE_TAG.FLOAT)).toBe(TOP); // TOP is a singleton
    expect(tagToAbstractValue(TYPE_TAG.NONE)).not.toBeNull();
    expect(tagToAbstractValue(TYPE_TAG.COMPLEX)).toBeNull();
  });
});
