import { StmtNS, ExprNS } from "../../ast-types";
import { Token } from "../../tokenizer";
import { TokenType } from "../../tokens";
import { PRIMITIVE_FUNCTIONS } from "./sinter-primitives";
import { SVMLProgram } from "./types";
import type { AbstractValue } from "../../types/abstract-value";
import { INT_BIT, BOOL_BIT, IntRef, BoolRef } from "../../types/abstract-value";
import type { AnalysisResult } from "../../specialization/types";
import type { SlotInfo } from "../../specialization/specialize-ast";
import { SVMLIRBuilder } from "./SVMLIRBuilder";
import OpCodes from "./opcodes";
import { FunctionEnvironments, Environment, Resolver } from "../../resolver";
import { InstrumentationTracker } from "./instrumentation";
import { BackwardsBindings } from "../backwards-bindings";

// Fast compiler annotations for maximum performance
interface CompilerAnnotation {
  slot: number; // Variable slot index within environment
  envLevel: number; // Environment nesting level (0 = local)
  isPrimitive: boolean; // True if this is a builtin function
  primitiveIndex?: number; // Index in PRIMITIVE_FUNCTIONS if isPrimitive
}

export type ExpressionResult = {
  maxStackSize: number;
};

/**
 * SVML Compiler implementing visitor interface
 */
export class SVMLCompiler
  implements StmtNS.Visitor<ExpressionResult>, ExprNS.Visitor<ExpressionResult>
{
  private builder: SVMLIRBuilder;
  private currentEnvironment: Environment;
  private functionEnvironments: FunctionEnvironments;
  private isTailCall: boolean;

  // Ultra-fast annotation cache (no string lookups during compilation)
  private tokenAnnotations = new WeakMap<Token, CompilerAnnotation>();
  // Per-environment slot assignment for variables
  private envSlotCounters = new WeakMap<Environment, number>();
  private envSlotMaps = new WeakMap<Environment, Map<string, number>>();

  // Instrumentation tracker for recursion detection and memoization
  private instrumentation: InstrumentationTracker;

  // AST-level specialization annotations (optional)
  private astAnnotations: WeakMap<object, AbstractValue> | null = null;

  // Deterministic counter for temporary variable names
  private tmpCounter = 0;

  // Maps function index → AST node for respecialization
  private functionASTMap: Map<number, object> = new Map();

  // Bidirectional AST node <-> function index bindings
  private bindings: BackwardsBindings<number> = new BackwardsBindings();

  // Loop stack for break/continue support
  private loopStack: Array<{
    breakLabel: number;
    continueLabel: number;
    iteratorOnStack: boolean;
  }> = [];

  constructor(
    currentEnvironment: Environment,
    functionEnvironments: FunctionEnvironments,
    builder: SVMLIRBuilder,
    instrumentation?: InstrumentationTracker,
    astAnnotations?: WeakMap<object, AbstractValue> | null,
    functionASTMap?: Map<number, object>,
    bindings?: BackwardsBindings<number>,
  ) {
    this.builder = builder;
    this.currentEnvironment = currentEnvironment;
    this.functionEnvironments = functionEnvironments;
    this.isTailCall = false;
    this.instrumentation = instrumentation || new InstrumentationTracker();
    this.astAnnotations = astAnnotations ?? null;
    this.functionASTMap = functionASTMap ?? new Map();
    this.bindings = bindings ?? new BackwardsBindings();
  }

  /**
   * Recompile a single function with AST annotations.
   * Uses the stored compiler context to avoid re-resolving environments.
   */
  recompileFunctionWithAnnotations(
    funcNode: StmtNS.FunctionDef | ExprNS.Lambda | ExprNS.MultiLambda,
    annotations: AnalysisResult,
  ): import("./types").SVMLIR {
    const childBuilder = new SVMLIRBuilder(funcNode.parameters.length);

    const nextEnvironment = this.functionEnvironments.get(funcNode);
    if (!nextEnvironment) {
      throw new Error("Function environment not found during recompilation");
    }

    // Do NOT call bindings.register() here: the function index is unchanged
    // from the initial compilation pass, so the node -> index mapping already
    // exists in this.bindings. A second register() would trip the duplicate-id guard.

    // Use a fresh BackwardsBindings for recompilation: the initial-pass indices
    // are already registered in this.bindings, and recompilation assigns new
    // indices for nested functions that must not clash with them.
    const compiler = new SVMLCompiler(
      nextEnvironment,
      this.functionEnvironments,
      childBuilder,
      this.instrumentation,
      annotations.exprTypes,
      this.functionASTMap,
      new BackwardsBindings(), // fresh: recompilation bindings are throwaway
    );

    // Set up param slots (same as fromFunctionNode)
    const slotMap = new Map<string, number>();
    compiler.envSlotMaps.set(nextEnvironment, slotMap);
    for (let i = 0; i < funcNode.parameters.length; i++) {
      const paramName = funcNode.parameters[i].lexeme;
      slotMap.set(paramName, i);
      nextEnvironment.lookupNameCurrentEnvWithError(funcNode.parameters[i]);
    }
    compiler.envSlotCounters.set(nextEnvironment, funcNode.parameters.length);

    // Compile function body
    let body: StmtNS.Stmt[];
    if (funcNode instanceof ExprNS.Lambda) {
      body = [new StmtNS.Return(funcNode.startToken, funcNode.endToken, funcNode.body)];
    } else if (funcNode instanceof ExprNS.MultiLambda) {
      body = funcNode.body;
    } else {
      body = funcNode.body;
    }

    compiler.compileStatements(body);
    childBuilder.emitNullary(OpCodes.RETG);

    return childBuilder.build();
  }

  /**
   * Create SVMLCompiler from program AST
   */
  static fromProgram(program: StmtNS.FileInput): SVMLCompiler {
    const resolver = new Resolver("", program);
    const functionEnvironments = resolver.resolveEnvironments(program);
    const mainEnv = functionEnvironments.get(program);
    if (!mainEnv) {
      throw new Error("Main program environment not found");
    }
    SVMLIRBuilder.resetIndex();
    const builder = new SVMLIRBuilder(0);
    return new SVMLCompiler(mainEnv, functionEnvironments, builder);
  }

  fromFunctionNode(node: StmtNS.FunctionDef | ExprNS.Lambda | ExprNS.MultiLambda): SVMLCompiler {
    const nextEnvironment = this.functionEnvironments.get(node);
    if (!nextEnvironment) {
      throw new Error(`Function environment not found`);
    }
    for (const param of node.parameters) {
      nextEnvironment.lookupNameCurrentEnvWithError(param);
    }
    const numArgs = node.parameters.length;
    const builder = this.builder.createChildBuilder(numArgs);

    const compiler = new SVMLCompiler(
      nextEnvironment,
      this.functionEnvironments,
      builder,
      this.instrumentation,
      this.astAnnotations,
      this.functionASTMap,
      this.bindings,
    );

    const slotMap = new Map<string, number>();
    compiler.envSlotMaps.set(nextEnvironment, slotMap);

    for (let i = 0; i < node.parameters.length; i++) {
      const paramName = node.parameters[i].lexeme;
      slotMap.set(paramName, i);
    }

    compiler.envSlotCounters.set(nextEnvironment, numArgs);

    return compiler;
  }

  /**
   * Compile entire program and return an immutable SVMLProgram.
   */
  compileProgram(program: StmtNS.FileInput): SVMLProgram {
    this.compile(program);

    const allBuilders = this.builder.getAllBuilders(true);
    const functions = allBuilders.map(b => b.build());

    return new SVMLProgram(0, functions, this.functionASTMap);
  }

  /**
   * Compile a statement or expression and return stack effect
   */
  compile(node: StmtNS.Stmt | ExprNS.Expr): ExpressionResult {
    return node.accept(this);
  }

  /**
   * Get the BackwardsBindings built during compilation.
   * Maps function indices back to their AST nodes for profiling.
   */
  getBindings(): BackwardsBindings<number> {
    return this.bindings;
  }

  /**
   * Get the instrumentation tracker
   */
  getInstrumentation(): InstrumentationTracker {
    return this.instrumentation;
  }

  /**
   * Get or create fast annotation for a token (O(1) lookup via WeakMap)
   */
  private getTokenAnnotation(token: Token): CompilerAnnotation {
    let annotation = this.tokenAnnotations.get(token);
    if (annotation) {
      return annotation;
    }

    const name = token.lexeme;
    const parentEnv = this.currentEnvironment.lookupNameEnv(token);

    // Handle primitive functions
    if (parentEnv === Environment.GlobalEnvironment) {
      const primitiveIndex = PRIMITIVE_FUNCTIONS.get(name);
      if (primitiveIndex === undefined) {
        throw new Error(`Primitive function ${name} not implemented`);
      }
      annotation = {
        slot: primitiveIndex,
        envLevel: 0,
        isPrimitive: true,
        primitiveIndex,
      };
    } else if (parentEnv != null) {
      // Handle user-declared variables
      const envLevel = this.currentEnvironment.lookupName(token);
      const slot = this.getOrAssignSlot(parentEnv, name);

      annotation = {
        slot,
        envLevel,
        isPrimitive: false,
      };
    } else {
      throw new Error(`Variable ${name} not found in environment`);
    }

    this.tokenAnnotations.set(token, annotation);
    return annotation;
  }

  /**
   * Assign variable slot in environment (O(1) with WeakMap)
   */
  private getOrAssignSlot(env: Environment, name: string): number {
    let slotMap = this.envSlotMaps.get(env);
    if (!slotMap) {
      slotMap = new Map();
      this.envSlotMaps.set(env, slotMap);
      this.envSlotCounters.set(env, 0);
    }

    let slot = slotMap.get(name);
    if (slot === undefined) {
      slot = this.envSlotCounters.get(env)!;
      slotMap.set(name, slot);
      this.envSlotCounters.set(env, slot + 1);
      this.builder.noteSymbolUsed();
    }
    return slot;
  }

  /**
   * Create a SlotLookup function for the AST specializer, using the
   * environment of the given function node.
   */
  createSlotLookupForFunction(
    funcNode: StmtNS.FunctionDef | ExprNS.Lambda | ExprNS.MultiLambda,
  ): (token: Token) => SlotInfo {
    const funcEnv = this.functionEnvironments.get(funcNode);
    if (!funcEnv) {
      throw new Error("Function environment not found for slot lookup");
    }

    // Pre-populate parameter slots to match the compiler's slot assignment.
    // During initial compilation, a child compiler assigns params to slots 0..N-1.
    // We must replicate that here so the specializer's slot indices match.
    if (!this.envSlotMaps.has(funcEnv)) {
      const slotMap = new Map<string, number>();
      this.envSlotMaps.set(funcEnv, slotMap);
      for (let i = 0; i < funcNode.parameters.length; i++) {
        slotMap.set(funcNode.parameters[i].lexeme, i);
      }
      this.envSlotCounters.set(funcEnv, funcNode.parameters.length);
    }

    return (token: Token): SlotInfo => {
      // Always do direct environment lookup — the main compiler's tokenAnnotations
      // cache won't contain entries for tokens inside function bodies (those were
      // cached in child compilers' WeakMaps during initial compilation).
      const name = token.lexeme;
      let annotation: CompilerAnnotation | undefined;
      const parentEnv = funcEnv.lookupNameEnv(token);

      if (parentEnv === Environment.GlobalEnvironment) {
        const primitiveIndex = PRIMITIVE_FUNCTIONS.get(name);
        if (primitiveIndex === undefined) {
          throw new Error(`Primitive function ${name} not implemented`);
        }
        annotation = { slot: primitiveIndex, envLevel: 0, isPrimitive: true, primitiveIndex };
      } else if (parentEnv != null) {
        const envLevel = funcEnv.lookupName(token);
        const slot = this.getOrAssignSlot(parentEnv, name);
        annotation = { slot, envLevel, isPrimitive: false };
      } else {
        throw new Error(`Variable ${name} not found in environment`);
      }

      this.tokenAnnotations.set(token, annotation);
      return {
        slot: annotation.slot,
        envLevel: annotation.envLevel,
        isPrimitive: annotation.isPrimitive,
      };
    };
  }

  /**
   * Set AST annotations for specialized compilation.
   */
  setASTAnnotations(annotations: WeakMap<object, AbstractValue>): void {
    this.astAnnotations = annotations;
  }

  /**
   * Get the AbstractValue annotation for an expression node, if any.
   */
  private getExprAnnotation(expr: ExprNS.Expr): AbstractValue | null {
    if (!this.astAnnotations) return null;
    return this.astAnnotations.get(expr) ?? null;
  }

  private emitLoadSymbol(token: Token, valueInfo?: AbstractValue | null): ExpressionResult {
    const annotation = this.getTokenAnnotation(token);

    if (annotation.isPrimitive) {
      return { maxStackSize: 0 };
    }
    const isInt = valueInfo && valueInfo.sound.kinds === INT_BIT;
    const isBool = valueInfo && valueInfo.sound.kinds === BOOL_BIT;
    if (annotation.envLevel === 0) {
      const opcode = isInt ? OpCodes.LDLF : isBool ? OpCodes.LDLB : OpCodes.LDLG;
      this.builder.emitUnary(opcode, annotation.slot);
    } else {
      const opcode = isInt ? OpCodes.LDPF : isBool ? OpCodes.LDPB : OpCodes.LDPG;
      this.builder.emitBinary(opcode, annotation.slot, annotation.envLevel);
    }
    return { maxStackSize: 1 };
  }

  private emitStoreSymbol(token: Token, valueInfo?: AbstractValue | null): void {
    const annotation = this.getTokenAnnotation(token);

    if (annotation.isPrimitive) {
      throw new Error(`Cannot assign to primitive symbol: ${token.lexeme}`);
    }

    const isInt = valueInfo && valueInfo.sound.kinds === INT_BIT;
    const isBool = valueInfo && valueInfo.sound.kinds === BOOL_BIT;
    if (annotation.envLevel === 0) {
      const opcode = isInt ? OpCodes.STLF : isBool ? OpCodes.STLB : OpCodes.STLG;
      this.builder.emitUnary(opcode, annotation.slot);
    } else {
      const opcode = isInt ? OpCodes.STPF : isBool ? OpCodes.STPB : OpCodes.STPG;
      this.builder.emitBinary(opcode, annotation.slot, annotation.envLevel);
    }
  }

  private emitFunctionCall(token: Token, numArgs: number): void {
    const annotation = this.getTokenAnnotation(token);

    if (annotation.isPrimitive) {
      const primitiveOpcode = this.isTailCall ? OpCodes.CALLTP : OpCodes.CALLP;
      this.builder.emitPrimitiveCall(primitiveOpcode, annotation.primitiveIndex!, numArgs);
    } else {
      const userOpcode = this.isTailCall ? OpCodes.CALLT : OpCodes.CALL;
      this.builder.emitCall(userOpcode, numArgs);
    }
  }

  // ========================================================================
  // Expression Visitor Methods
  // ========================================================================

  visitLiteralExpr(expr: ExprNS.Literal): ExpressionResult {
    const value = expr.value;

    if (value === null) {
      this.builder.emitNullary(OpCodes.LGCN);
    } else {
      switch (typeof value) {
        case "boolean":
          this.builder.emitNullary(value ? OpCodes.LGCB1 : OpCodes.LGCB0);
          break;
        case "number":
          if (Number.isInteger(value) && -2_147_483_648 <= value && value <= 2_147_483_647) {
            this.builder.emitUnary(OpCodes.LGCI, value);
          } else {
            this.builder.emitUnary(OpCodes.LGCF64, value);
          }
          break;
        case "string":
          this.builder.emitUnary(OpCodes.LGCS, value);
          break;
        default:
          throw new Error("Unsupported literal type");
      }
    }

    return { maxStackSize: 1 };
  }

  visitBigIntLiteralExpr(expr: ExprNS.BigIntLiteral): ExpressionResult {
    const numValue = Number(expr.value);
    if (Number.isInteger(numValue) && -2_147_483_648 <= numValue && numValue <= 2_147_483_647) {
      this.builder.emitUnary(OpCodes.LGCI, numValue);
    } else {
      this.builder.emitUnary(OpCodes.LGCF64, numValue);
    }

    return { maxStackSize: 1 };
  }

  visitComplexExpr(_expr: ExprNS.Complex): ExpressionResult {
    // For now, treat complex numbers as objects
    // This would need proper SVML support for complex numbers
    throw new Error("Complex numbers not yet supported in SVML compiler");
  }

  visitListExpr(expr: ExprNS.List): ExpressionResult {
    const n = expr.elements.length;
    // Allocate a temporary slot to hold the array
    const tmpName = `__list_tmp_${this.builder.getFunctionIndex()}_${n}_${this.tmpCounter++}`;
    const tmpSlot = this.getOrAssignSlot(this.currentEnvironment, tmpName);

    // Create the array
    this.builder.emitUnary(OpCodes.LGCI, n);
    this.builder.emitNullary(OpCodes.NEWA);
    this.builder.emitUnary(OpCodes.STLG, tmpSlot);

    // Fill each element
    for (let i = 0; i < n; i++) {
      this.builder.emitUnary(OpCodes.LDLG, tmpSlot); // push array
      this.builder.emitUnary(OpCodes.LGCI, i); // push index
      this.compile(expr.elements[i]); // push value
      this.builder.emitNullary(OpCodes.STAG); // arr[i] = value
    }

    // Leave array as result
    this.builder.emitUnary(OpCodes.LDLG, tmpSlot);

    return { maxStackSize: 3 + 1 };
  }

  visitSubscriptExpr(expr: ExprNS.Subscript): ExpressionResult {
    this.compile(expr.value);
    this.compile(expr.index);
    this.builder.emitNullary(OpCodes.LDAG);
    return { maxStackSize: 2 };
  }

  visitVariableExpr(expr: ExprNS.Variable): ExpressionResult {
    const info = this.getExprAnnotation(expr);
    this.emitLoadSymbol(expr.name, info);
    return { maxStackSize: 1 };
  }

  /**
   * Convert Python operator token to SVML binary operator
   */
  private getBinaryOpCode(operator: Token, isSpecializedNumber: boolean): number {
    switch (operator.type) {
      case TokenType.PLUS:
        return isSpecializedNumber ? OpCodes.ADDF : OpCodes.ADDG;
      case TokenType.MINUS:
        return isSpecializedNumber ? OpCodes.SUBF : OpCodes.SUBG;
      case TokenType.STAR:
        return isSpecializedNumber ? OpCodes.MULF : OpCodes.MULG;
      case TokenType.SLASH:
        return isSpecializedNumber ? OpCodes.DIVF : OpCodes.DIVG;
      case TokenType.PERCENT:
        return isSpecializedNumber ? OpCodes.MODF : OpCodes.MODG;
      case TokenType.DOUBLESLASH:
        return isSpecializedNumber ? OpCodes.FLOORDIVF : OpCodes.FLOORDIVG;
      default:
        throw new Error(`Unsupported binary operator: ${operator.lexeme}`);
    }
  }

  /**
   * Convert Python comparison operator token to SVML binary operator
   */
  private getCompareOpCode(
    operator: Token,
    specialization: "generic" | "number" | "boolean",
  ): number {
    switch (operator.type) {
      case TokenType.LESS:
        return specialization === "number" ? OpCodes.LTF : OpCodes.LTG;
      case TokenType.GREATER:
        return specialization === "number" ? OpCodes.GTF : OpCodes.GTG;
      case TokenType.LESSEQUAL:
        return specialization === "number" ? OpCodes.LEF : OpCodes.LEG;
      case TokenType.GREATEREQUAL:
        return specialization === "number" ? OpCodes.GEF : OpCodes.GEG;
      case TokenType.DOUBLEEQUAL:
        return specialization === "number"
          ? OpCodes.EQF
          : specialization === "boolean"
            ? OpCodes.EQB
            : OpCodes.EQG;
      case TokenType.NOTEQUAL:
        return specialization === "number"
          ? OpCodes.NEQF
          : specialization === "boolean"
            ? OpCodes.NEQB
            : OpCodes.NEQG;
      default:
        throw new Error(`Unsupported comparison operator: ${operator.lexeme}`);
    }
  }

  visitBinaryExpr(expr: ExprNS.Binary): ExpressionResult {
    const info = this.getExprAnnotation(expr);
    const leftInfo = this.getExprAnnotation(expr.left);
    const rightInfo = this.getExprAnnotation(expr.right);

    // Zero identity elimination (only when result is exclusively int)
    if (info && info.sound.kinds === INT_BIT) {
      const leftZero = leftInfo && leftInfo.sound.intRef === IntRef.Zero;
      const rightZero = rightInfo && rightInfo.sound.intRef === IntRef.Zero;

      if (expr.operator.type === TokenType.PLUS || expr.operator.type === TokenType.MINUS) {
        if (rightZero) return this.compile(expr.left); // x + 0, x - 0
        if (leftZero && expr.operator.type === TokenType.PLUS) return this.compile(expr.right); // 0 + x
      }
      if (expr.operator.type === TokenType.STAR) {
        if (leftZero || rightZero) {
          this.builder.emitUnary(OpCodes.LGCI, 0);
          return { maxStackSize: 1 };
        }
      }
    }

    const isSpecializedNumber = info != null && info.sound.kinds === INT_BIT;
    const opcode = this.getBinaryOpCode(expr.operator, isSpecializedNumber);

    // Compile left operand
    const leftResult = this.compile(expr.left);

    // Compile right operand
    const rightResult = this.compile(expr.right);

    // Emit the operation
    this.builder.emitNullary(opcode);

    return {
      maxStackSize: Math.max(leftResult.maxStackSize, 1 + rightResult.maxStackSize),
    };
  }

  visitCompareExpr(expr: ExprNS.Compare): ExpressionResult {
    // Check if the specializer proved the comparison result
    const resultInfo = this.getExprAnnotation(expr);
    if (resultInfo && resultInfo.sound.kinds === BOOL_BIT) {
      if (resultInfo.sound.boolRef === BoolRef.True) {
        this.builder.emitNullary(OpCodes.LGCB1);
        return { maxStackSize: 1 };
      }
      if (resultInfo.sound.boolRef === BoolRef.False) {
        this.builder.emitNullary(OpCodes.LGCB0);
        return { maxStackSize: 1 };
      }
    }

    // Fall through: compile normally with opcode specialization
    const leftInfo = this.getExprAnnotation(expr.left);
    const rightInfo = this.getExprAnnotation(expr.right);
    const leftIsInt = leftInfo && leftInfo.sound.kinds === INT_BIT;
    const rightIsInt = rightInfo && rightInfo.sound.kinds === INT_BIT;
    const leftIsBool = leftInfo && leftInfo.sound.kinds === BOOL_BIT;
    const rightIsBool = rightInfo && rightInfo.sound.kinds === BOOL_BIT;
    const specialization: "generic" | "number" | "boolean" =
      leftIsInt && rightIsInt ? "number" : leftIsBool && rightIsBool ? "boolean" : "generic";
    const opcode = this.getCompareOpCode(expr.operator, specialization);

    // Compile left operand
    const leftResult = this.compile(expr.left);

    // Compile right operand
    const rightResult = this.compile(expr.right);

    // Emit the operation
    this.builder.emitNullary(opcode);

    return {
      maxStackSize: Math.max(leftResult.maxStackSize, 1 + rightResult.maxStackSize),
    };
  }

  visitBoolOpExpr(expr: ExprNS.BoolOp): ExpressionResult {
    const leftInfo = this.getExprAnnotation(expr.left);
    const leftKnownBool = leftInfo && leftInfo.sound.kinds === BOOL_BIT;

    if (expr.operator.type === TokenType.AND) {
      if (leftKnownBool && leftInfo.sound.boolRef === BoolRef.False) {
        this.builder.emitNullary(OpCodes.LGCB0);
        return { maxStackSize: 1 };
      }
      if (leftKnownBool && leftInfo.sound.boolRef === BoolRef.True) {
        return this.compile(expr.right);
      }
      // left && right -> left ? right : false
      const testResult = this.compile(expr.left);
      const elseLabel = this.builder.emitJump(OpCodes.BRF);

      const conseqResult = this.compile(expr.right);
      const endLabel = this.builder.emitJump(OpCodes.BR);

      this.builder.markLabel(elseLabel);
      this.builder.emitNullary(OpCodes.LGCB0); // false
      const altResult = { maxStackSize: 1 };

      this.builder.markLabel(endLabel);

      return {
        maxStackSize: Math.max(
          testResult.maxStackSize,
          conseqResult.maxStackSize,
          altResult.maxStackSize,
        ),
      };
    } else if (expr.operator.type === TokenType.OR) {
      if (leftKnownBool && leftInfo.sound.boolRef === BoolRef.True) {
        this.builder.emitNullary(OpCodes.LGCB1);
        return { maxStackSize: 1 };
      }
      if (leftKnownBool && leftInfo.sound.boolRef === BoolRef.False) {
        return this.compile(expr.right);
      }
      // left || right -> left ? true : right
      const testResult = this.compile(expr.left);
      const elseLabel = this.builder.emitJump(OpCodes.BRF);

      this.builder.emitNullary(OpCodes.LGCB1); // true
      const conseqResult = { maxStackSize: 1 };
      const endLabel = this.builder.emitJump(OpCodes.BR);

      this.builder.markLabel(elseLabel);
      const altResult = this.compile(expr.right);

      this.builder.markLabel(endLabel);

      return {
        maxStackSize: Math.max(
          testResult.maxStackSize,
          conseqResult.maxStackSize,
          altResult.maxStackSize,
        ),
      };
    }
    throw new Error(`Unsupported boolean operator: ${expr.operator.lexeme}`);
  }

  visitUnaryExpr(expr: ExprNS.Unary): ExpressionResult {
    let opcode: number;
    const info = this.getExprAnnotation(expr);

    const isInt = info && info.sound.kinds === INT_BIT;
    const isBool = info && info.sound.kinds === BOOL_BIT;

    switch (expr.operator.type) {
      case TokenType.NOT: {
        const operandInfo = this.getExprAnnotation(expr.right);
        if (operandInfo && operandInfo.sound.kinds === BOOL_BIT) {
          if (operandInfo.sound.boolRef === BoolRef.True) {
            this.builder.emitNullary(OpCodes.LGCB0);
            return { maxStackSize: 1 };
          }
          if (operandInfo.sound.boolRef === BoolRef.False) {
            this.builder.emitNullary(OpCodes.LGCB1);
            return { maxStackSize: 1 };
          }
        }
        opcode = isBool ? OpCodes.NOTB : OpCodes.NOTG;
        break;
      }
      case TokenType.MINUS:
        opcode = isInt ? OpCodes.NEGF : OpCodes.NEGG;
        break;
      case TokenType.PLUS:
        // Unary plus - for now just return the operand
        return this.compile(expr.right);
      default:
        throw new Error(`Unsupported unary operator: ${expr.operator.lexeme}`);
    }

    // Compile the operand
    const operandResult = this.compile(expr.right);

    // Emit the operation
    this.builder.emitNullary(opcode);

    return { maxStackSize: operandResult.maxStackSize };
  }

  visitCallExpr(expr: ExprNS.Call): ExpressionResult {
    // Instrumentation: record this call
    this.instrumentation.recordCall(expr);

    if (!(expr.callee instanceof ExprNS.Variable)) {
      throw new Error("Unsupported call expression: callee must be an identifier");
    }

    const callee: ExprNS.Variable = expr.callee;

    // Load function if needed
    const { maxStackSize: functionStackEffect } = this.emitLoadSymbol(callee.name);

    // Compile arguments
    let maxArgStackSize = 0;
    for (let i = 0; i < expr.args.length; i++) {
      const argResult = this.compile(expr.args[i]);
      maxArgStackSize = Math.max(maxArgStackSize, i + argResult.maxStackSize);
    }

    // Emit call instruction
    const numArgs = expr.args.length;
    this.emitFunctionCall(callee.name, numArgs);

    return {
      maxStackSize: functionStackEffect + maxArgStackSize,
    };
  }

  visitTernaryExpr(expr: ExprNS.Ternary): ExpressionResult {
    const predInfo = this.getExprAnnotation(expr.predicate);
    if (predInfo && predInfo.sound.kinds === BOOL_BIT) {
      if (predInfo.sound.boolRef === BoolRef.True) {
        return this.compile(expr.consequent);
      }
      if (predInfo.sound.boolRef === BoolRef.False) {
        return this.compile(expr.alternative);
      }
    }

    // Compile test
    const testResult = this.compile(expr.predicate);
    const elseLabel = this.builder.emitJump(OpCodes.BRF);

    // Compile consequent
    const conseqResult = this.compile(expr.consequent);
    const endLabel = this.builder.emitJump(OpCodes.BR);

    // Compile alternate
    this.builder.markLabel(elseLabel);
    const altResult = this.compile(expr.alternative);

    this.builder.markLabel(endLabel);

    return {
      maxStackSize: Math.max(
        testResult.maxStackSize,
        conseqResult.maxStackSize,
        altResult.maxStackSize,
      ),
    };
  }

  visitNoneExpr(_expr: ExprNS.None): ExpressionResult {
    this.builder.emitNullary(OpCodes.LGCU);
    return { maxStackSize: 1 };
  }

  visitLambdaExpr(expr: ExprNS.Lambda): ExpressionResult {
    const ast: StmtNS.Stmt = new StmtNS.Return(expr.startToken, expr.endToken, expr.body);

    // Compile lambda body in child environment
    const compiler = this.fromFunctionNode(expr);

    // functionASTMap feeds SVMLProgram for the interpreter's JIT specialization path.
    // bindings feeds BackwardsBindings.resolve() for the profiling/collectTypeInfo path.
    // Both are kept in sync here; consolidation is a future cleanup once the
    // interpreter's JIT path migrates to BackwardsBindings as well.
    this.functionASTMap.set(compiler.builder.getFunctionIndex(), expr);
    this.bindings.register(expr, compiler.builder.getFunctionIndex());

    // Instrumentation: enter lambda
    this.instrumentation.enterFunction(expr, compiler.builder.getFunctionIndex());

    const { maxStackSize } = compiler.compile(ast);

    // Instrumentation: exit lambda
    this.instrumentation.exitFunction();

    // Add return if needed (functions should always return something)
    compiler.builder.emitNullary(OpCodes.RETG);

    // Emit function creation instruction in current environment
    this.builder.emitUnary(OpCodes.NEWC, compiler.builder.getFunctionIndex());

    return { maxStackSize: Math.max(maxStackSize, 1) };
  }

  visitMultiLambdaExpr(expr: ExprNS.MultiLambda): ExpressionResult {
    const ast: StmtNS.Stmt[] = expr.body;

    // Compile lambda body in child environment
    const compiler = this.fromFunctionNode(expr);

    // Record AST for respecialization
    this.functionASTMap.set(compiler.builder.getFunctionIndex(), expr);
    this.bindings.register(expr, compiler.builder.getFunctionIndex());

    // Instrumentation: enter multi-lambda
    this.instrumentation.enterFunction(expr, compiler.builder.getFunctionIndex());

    const { maxStackSize } = compiler.compileStatements(ast);

    // Instrumentation: exit multi-lambda
    this.instrumentation.exitFunction();

    // Add return if needed (functions should always return something)
    compiler.builder.emitNullary(OpCodes.RETG);

    // Emit function creation instruction in current environment
    this.builder.emitUnary(OpCodes.NEWC, compiler.builder.getFunctionIndex());

    return { maxStackSize: Math.max(maxStackSize, 1) };
  }

  visitGroupingExpr(expr: ExprNS.Grouping): ExpressionResult {
    return this.compile(expr.expression);
  }

  visitSimpleExprStmt(stmt: StmtNS.SimpleExpr): ExpressionResult {
    return this.compile(stmt.expression);
  }

  visitReturnStmt(stmt: StmtNS.Return): ExpressionResult {
    if (!stmt.value) {
      this.builder.emitNullary(OpCodes.LGCU);
      this.builder.emitNullary(OpCodes.RETG);
      return { maxStackSize: 1 };
    }
    const result = this.compile(stmt.value);
    this.builder.emitNullary(OpCodes.RETG);
    return result;
  }

  visitAssignStmt(stmt: StmtNS.Assign): ExpressionResult {
    const initResult = this.compile(stmt.value);

    // Emit store instruction with value type info for specialization
    const valueInfo = this.getExprAnnotation(stmt.value);
    this.emitStoreSymbol((stmt.target as ExprNS.Variable).name, valueInfo);

    this.builder.emitNullary(OpCodes.LGCU);
    return initResult;
  }

  visitFunctionDefStmt(stmt: StmtNS.FunctionDef): ExpressionResult {
    const ast: StmtNS.Stmt[] = stmt.body;

    // Compile function body in child environment
    const childCompiler = this.fromFunctionNode(stmt);

    // Record AST for respecialization
    this.functionASTMap.set(childCompiler.builder.getFunctionIndex(), stmt);
    this.bindings.register(stmt, childCompiler.builder.getFunctionIndex());

    // Instrumentation: enter function
    this.instrumentation.enterFunction(stmt, childCompiler.builder.getFunctionIndex());

    const { maxStackSize } = childCompiler.compileStatements(ast);

    // Instrumentation: exit function
    this.instrumentation.exitFunction();

    // Add return if needed (functions should always return something)
    childCompiler.builder.emitNullary(OpCodes.RETG);

    // Add function creation instruction
    this.builder.emitUnary(OpCodes.NEWC, childCompiler.builder.getFunctionIndex());

    // Assign function as variable
    this.emitStoreSymbol(stmt.name);

    // Load it right back
    this.emitLoadSymbol(stmt.name);

    return { maxStackSize: Math.max(maxStackSize, 1) };
  }

  visitIfStmt(stmt: StmtNS.If): ExpressionResult {
    // Check if the specializer proved the condition
    const condInfo = this.getExprAnnotation(stmt.condition);
    if (condInfo && condInfo.sound.kinds === BOOL_BIT) {
      if (condInfo.sound.boolRef === BoolRef.True) {
        // Condition always true → emit only true branch
        return this.compileStatements(stmt.body);
      }
      if (condInfo.sound.boolRef === BoolRef.False) {
        // Condition always false → emit only else branch
        if (stmt.elseBlock) {
          return this.compileStatements(stmt.elseBlock);
        }
        this.builder.emitNullary(OpCodes.LGCU);
        return { maxStackSize: 1 };
      }
    }

    // Fall through: compile normally with both branches
    const testResult = this.compile(stmt.condition);
    const elseLabel = this.builder.emitJump(OpCodes.BRF);

    const conseqResult = this.compileStatements(stmt.body);
    const endLabel = this.builder.emitJump(OpCodes.BR);

    this.builder.markLabel(elseLabel);
    const altResult = stmt.elseBlock
      ? this.compileStatements(stmt.elseBlock)
      : (() => {
          this.builder.emitNullary(OpCodes.LGCU);
          return { maxStackSize: 1 };
        })();

    this.builder.markLabel(endLabel);

    return {
      maxStackSize: Math.max(
        testResult.maxStackSize,
        conseqResult.maxStackSize,
        altResult.maxStackSize,
      ),
    };
  }

  visitWhileStmt(stmt: StmtNS.While): ExpressionResult {
    const condInfo = this.getExprAnnotation(stmt.condition);

    // While False: loop never executes
    if (condInfo && condInfo.sound.kinds === BOOL_BIT && condInfo.sound.boolRef === BoolRef.False) {
      this.builder.emitNullary(OpCodes.LGCU);
      return { maxStackSize: 1 };
    }

    // While True: skip condition evaluation each iteration
    if (condInfo && condInfo.sound.kinds === BOOL_BIT && condInfo.sound.boolRef === BoolRef.True) {
      const loopLabel = this.builder.markLabel();
      const endLabel = this.builder.getNextLabel();
      this.loopStack.push({
        breakLabel: endLabel,
        continueLabel: loopLabel,
        iteratorOnStack: false,
      });
      const bodyResult = this.compileStatements(stmt.body);
      this.builder.emitNullary(OpCodes.POPG);
      this.builder.emitJump(OpCodes.BR, loopLabel);
      this.loopStack.pop();
      this.builder.markLabel(endLabel);
      this.builder.emitNullary(OpCodes.LGCU);
      return { maxStackSize: Math.max(bodyResult.maxStackSize, 1) };
    }

    const loopLabel = this.builder.markLabel();
    const endLabel = this.builder.getNextLabel();

    this.loopStack.push({
      breakLabel: endLabel,
      continueLabel: loopLabel,
      iteratorOnStack: false,
    });

    // Compile test
    const testResult = this.compile(stmt.condition);
    this.builder.emitJump(OpCodes.BRF, endLabel);

    // Compile body
    const bodyResult = this.compileStatements(stmt.body);
    // Pop body result (while body values aren't used), matching for-loop behaviour
    this.builder.emitNullary(OpCodes.POPG);
    this.builder.emitJump(OpCodes.BR, loopLabel);

    this.loopStack.pop();

    this.builder.markLabel(endLabel);
    this.builder.emitNullary(OpCodes.LGCU); // While loops return undefined

    return {
      maxStackSize: Math.max(testResult.maxStackSize, bodyResult.maxStackSize, 1),
    };
  }

  visitPassStmt(_stmt: StmtNS.Pass): ExpressionResult {
    this.builder.emitNullary(OpCodes.LGCU);
    return { maxStackSize: 1 };
  }

  visitAnnAssignStmt(_stmt: StmtNS.AnnAssign): ExpressionResult {
    throw new Error("AnnAssign not yet implemented in SVML compiler");
  }

  visitBreakStmt(_stmt: StmtNS.Break): ExpressionResult {
    if (this.loopStack.length === 0) {
      throw new Error("Break statement outside loop");
    }
    const { breakLabel, iteratorOnStack } = this.loopStack[this.loopStack.length - 1];
    if (iteratorOnStack) {
      this.builder.emitNullary(OpCodes.POPG); // drop iterator
    }
    this.builder.emitJump(OpCodes.BR, breakLabel);
    return { maxStackSize: 0 };
  }

  visitContinueStmt(_stmt: StmtNS.Continue): ExpressionResult {
    if (this.loopStack.length === 0) {
      throw new Error("Continue statement outside loop");
    }
    const { continueLabel } = this.loopStack[this.loopStack.length - 1];
    this.builder.emitJump(OpCodes.BR, continueLabel);
    return { maxStackSize: 0 };
  }

  visitFromImportStmt(_stmt: StmtNS.FromImport): ExpressionResult {
    throw new Error("FromImport not yet implemented in SVML compiler");
  }

  visitGlobalStmt(_stmt: StmtNS.Global): ExpressionResult {
    this.builder.emitNullary(OpCodes.LGCU);
    return { maxStackSize: 1 };
  }

  visitNonLocalStmt(_stmt: StmtNS.NonLocal): ExpressionResult {
    this.builder.emitNullary(OpCodes.LGCU);
    return { maxStackSize: 1 };
  }

  visitAssertStmt(_stmt: StmtNS.Assert): ExpressionResult {
    throw new Error("Assert not yet implemented in SVML compiler");
  }

  visitForStmt(stmt: StmtNS.For): ExpressionResult {
    // Compile iterable and wrap in iterator
    this.compile(stmt.iter);
    this.builder.emitNullary(OpCodes.NEWITER);

    // Allocate labels
    const loopStartLabel = this.builder.markLabel();
    const loopEndLabel = this.builder.getNextLabel();

    this.loopStack.push({
      breakLabel: loopEndLabel,
      continueLabel: loopStartLabel,
      iteratorOnStack: true,
    });

    // FOR_ITER: if exhausted, pop iter and jump to loopEnd; else push next value
    this.builder.emitJump(OpCodes.FOR_ITER, loopEndLabel);

    // Store next value into loop variable (iterator stays on stack below)
    const targetSlot = this.getOrAssignSlot(this.currentEnvironment, stmt.target.lexeme);
    this.builder.emitUnary(OpCodes.STLG, targetSlot);

    // Compile loop body
    const bodyResult = this.compileStatements(stmt.body);
    // Pop body result (loop body values aren't used)
    this.builder.emitNullary(OpCodes.POPG);

    // Jump back to loop start
    this.builder.emitJump(OpCodes.BR, loopStartLabel);

    this.loopStack.pop();

    // Mark loop end (iterator already popped by FOR_ITER on exhaustion)
    this.builder.markLabel(loopEndLabel);
    this.builder.emitNullary(OpCodes.LGCU); // for-loop produces undefined

    return { maxStackSize: Math.max(bodyResult.maxStackSize + 2, 2) };
  }

  visitFileInputStmt(stmt: StmtNS.FileInput): ExpressionResult {
    const { maxStackSize } = this.compileStatements(stmt.statements);
    this.builder.emitNullary(OpCodes.RETG);
    return { maxStackSize: Math.max(maxStackSize, 1) };
  }

  compileStatements(statements: StmtNS.Stmt[]): ExpressionResult {
    if (statements.length === 0) {
      this.builder.emitNullary(OpCodes.LGCU);
      return { maxStackSize: 1 };
    }

    let maxStackSize = 0;

    for (let i = 0; i < statements.length; i++) {
      const result = this.compile(statements[i]);
      maxStackSize = Math.max(maxStackSize, result.maxStackSize);

      // Assumption: every statement/expression leaves exactly one value.
      // Earlier statement results are not needed and would otherwise accumulate,
      // breaking block-level stack balance. Pop N-1 intermediates so only the last
      // statement's value remains (the block result). Any leftovers indicate a
      // compiler emission bug (e.g. extra LGCU or unconsumed operands).
      if (i < statements.length - 1) {
        this.builder.emitNullary(OpCodes.POPG);
      }
    }

    return { maxStackSize };
  }
}
