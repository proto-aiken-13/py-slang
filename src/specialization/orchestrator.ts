import type { StmtNS } from "../ast-types";
import type { TypeEnv } from "../types/abstract-value";
import type { AnalysisResult, SlotLookup } from "./types";

export interface Analyzer {
  analyze(body: StmtNS.Stmt[], bindings: TypeEnv, slotLookup: SlotLookup): AnalysisResult;
}

export class AnalysisCache {
  private cache = new Map<string, AnalysisResult>();

  constructor(private analyzer: Analyzer) {}

  getOrAnalyze(
    funcIndex: number,
    body: StmtNS.Stmt[],
    bindings: TypeEnv,
    slotLookup: SlotLookup,
  ): AnalysisResult {
    const key = this.cacheKey(funcIndex, bindings);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = this.analyzer.analyze(body, bindings, slotLookup);
    this.cache.set(key, result);
    return result;
  }

  private cacheKey(funcIndex: number, bindings: TypeEnv): string {
    const parts: string[] = [];
    for (const [slot, av] of bindings) {
      parts.push(`${slot}_${av.sound.kinds};${av.sound.intRef};${av.sound.boolRef}`);
    }
    parts.sort();
    return `${funcIndex}:${parts.join("|")}`;
  }
}
