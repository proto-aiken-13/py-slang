// Re-export types from the shared product lattice module
export type {
  SoundType,
  AbstractValue,
  TypeEnv,
  AnalysisResult,
  SlotInfo,
  SlotLookup,
  SpecializableFunctionNode,
  FunctionProfile,
  TypeInformation,
} from "./types";
export {
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
} from "./types";

// Re-export AST specialization
export { specializeAST } from "./specialize-ast";

// Re-export transfer functions
export {
  transferBinaryOp,
  transferCompare,
  transferUnaryNeg,
  transferNot,
  negSign,
  addSigns,
  subSigns,
  mulSigns,
  divSigns,
  modSigns,
  notBoolRef,
  ltSigns,
  gtSigns,
  leSigns,
  geSigns,
  eqSigns,
  neqSigns,
} from "./transfer";
