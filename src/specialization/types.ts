import { StmtNS, ExprNS } from "../ast-types";

// Re-export the product lattice types
export type { SoundType, AbstractValue, TypeEnv } from "../types/abstract-value";
export {
  INT_BIT,
  BOOL_BIT,
  STR_BIT,
  NULL_BIT,
  CLOSURE_BIT,
  FLOAT_BIT,
  COMPLEX_BIT,
  ALL_KINDS_MASK,
} from "../types/abstract-value";
export { IntRef, BoolRef } from "../types/abstract-value";

export interface AnalysisResult {
  exprTypes: WeakMap<object, import("../types/abstract-value").AbstractValue>;
  inEnv: WeakMap<object, import("../types/abstract-value").TypeEnv>;
  outEnv: WeakMap<object, import("../types/abstract-value").TypeEnv>;
}

export interface SlotInfo {
  slot: number;
  envLevel: number;
  isPrimitive: boolean;
}

export type SlotLookup = (token: import("../tokenizer").Token) => SlotInfo;

/**
 * A function node that the specializer can profile and annotate.
 * Single source of truth — re-exported through index.ts.
 */
export type SpecializableFunctionNode = StmtNS.FunctionDef | ExprNS.Lambda | ExprNS.MultiLambda;

/**
 * Type profile observed for one call-site signature of a function.
 * Key = parameter position (0-indexed); value = the AbstractValue observed for that argument.
 * Parameter position is used (not backend-specific slot indices) so profiles are backend-agnostic.
 */
export type FunctionProfile = ReadonlyMap<number, import("../types/abstract-value").AbstractValue>;

/**
 * Aggregate profiling output from a Backend run.
 * Maps each profiled function node to the list of distinct FunctionProfiles observed.
 * Produced by Backend.collectTypeInfo() after Backend.run() completes.
 */
export type TypeInformation = ReadonlyMap<SpecializableFunctionNode, FunctionProfile[]>;
