/* eslint-disable @typescript-eslint/no-explicit-any */
import { SpecializationOrchestrator } from "../orchestration/orchestrator";
import type { Specializer } from "../orchestration/orchestrator";
import type { AnalysisResult } from "../specialization/types";
import type { TypeEnv } from "../types/abstract-value";
import { positiveInteger, negativeInteger } from "../types/lattice-ops";

function makeMockResult(): AnalysisResult {
  return {
    exprTypes: new WeakMap(),
    inEnv: new WeakMap(),
    outEnv: new WeakMap(),
  };
}

describe("SpecializationOrchestrator", () => {
  let analyzeFn: jest.Mock;
  let specializer: Specializer;
  let orchestrator: SpecializationOrchestrator;

  beforeEach(() => {
    analyzeFn = jest.fn().mockReturnValue(makeMockResult());
    specializer = { analyze: analyzeFn };
    orchestrator = new SpecializationOrchestrator(specializer);
  });

  test("calls specializer on cache miss", () => {
    const body: any[] = [];
    const bindings: TypeEnv = new Map([[0, positiveInteger()]]);
    const slotLookup: any = () => ({ slot: 0, envLevel: 0, isPrimitive: true });

    orchestrator.getOrAnalyze(0, body, bindings, slotLookup);

    expect(analyzeFn).toHaveBeenCalledTimes(1);
    expect(analyzeFn).toHaveBeenCalledWith(body, bindings, slotLookup);
  });

  test("returns cached result on cache hit", () => {
    const body: any[] = [];
    const bindings: TypeEnv = new Map([[0, positiveInteger()]]);
    const slotLookup: any = () => ({ slot: 0, envLevel: 0, isPrimitive: true });

    const result1 = orchestrator.getOrAnalyze(0, body, bindings, slotLookup);
    const result2 = orchestrator.getOrAnalyze(0, body, bindings, slotLookup);

    expect(analyzeFn).toHaveBeenCalledTimes(1);
    expect(result1).toBe(result2);
  });

  test("different bindings produce cache miss", () => {
    const body: any[] = [];
    const bindingsA: TypeEnv = new Map([[0, positiveInteger()]]);
    const bindingsB: TypeEnv = new Map([[0, negativeInteger()]]);
    const slotLookup: any = () => ({ slot: 0, envLevel: 0, isPrimitive: true });

    orchestrator.getOrAnalyze(0, body, bindingsA, slotLookup);
    orchestrator.getOrAnalyze(0, body, bindingsB, slotLookup);

    expect(analyzeFn).toHaveBeenCalledTimes(2);
  });

  test("cache key is insertion-order independent", () => {
    const body: any[] = [];
    const slotLookup: any = () => ({ slot: 0, envLevel: 0, isPrimitive: true });

    const bindingsAB: TypeEnv = new Map([
      [0, positiveInteger()],
      [1, negativeInteger()],
    ]);
    const bindingsBA: TypeEnv = new Map([
      [1, negativeInteger()],
      [0, positiveInteger()],
    ]);

    const result1 = orchestrator.getOrAnalyze(0, body, bindingsAB, slotLookup);
    const result2 = orchestrator.getOrAnalyze(0, body, bindingsBA, slotLookup);

    expect(analyzeFn).toHaveBeenCalledTimes(1);
    expect(result1).toBe(result2);
  });
});
