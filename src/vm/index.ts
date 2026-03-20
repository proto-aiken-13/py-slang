// Core compiler
export { SVMLCompiler } from "./svml-compiler";

// TypeScript interpreter
export { SVMLInterpreter } from "./svml-interpreter";

// Instrumentation and optimization
export {
  InstrumentationTracker,
  InstrumentationConfig,
  DEFAULT_INSTRUMENTATION_CONFIG,
  FunctionInfo,
} from "./instrumentation";

// Types
export { SVMLProgram, SVMLIR, Instruction } from "./types";

// Opcodes
export { default as OpCodes } from "./opcodes";

// Primitives
export { PRIMITIVE_FUNCTIONS, executePrimitive } from "./sinter-primitives";
