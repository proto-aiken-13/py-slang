import { StmtNS, ExprNS } from "../ast-types";
import { TokenType } from "../tokens";
import type { AbstractValue, TypeEnv } from "../types/abstract-value";
import { INT_BIT, BOOL_BIT, STR_BIT, BoolRef } from "../types/abstract-value";
import {
  join,
  TOP,
  positiveInteger,
  negativeInteger,
  zeroInteger,
  trueValue,
  falseValue,
  stringValue,
  nullValue,
  closureValue,
  boolean as booleanValue,
} from "../types/lattice-ops";
import {
  transferBinaryOp,
  transferCompare,
  transferUnaryNeg,
  transferNot,
} from "./transfer";
import type { AnalysisResult, SlotInfo, SlotLookup } from "./types";

// Re-export for backward compatibility
export type { SlotInfo, SlotLookup } from "./types";

/**
 * Map from TokenType to the operator string expected by transfer functions.
 */
const BINARY_OP_MAP: ReadonlyMap<TokenType, string> = new Map([
  [TokenType.PLUS, "+"],
  [TokenType.MINUS, "-"],
  [TokenType.STAR, "*"],
  [TokenType.SLASH, "/"],
  [TokenType.DOUBLESLASH, "//"],
  [TokenType.PERCENT, "%"],
]);

const COMPARE_OP_MAP: ReadonlyMap<TokenType, string> = new Map([
  [TokenType.LESS, "<"],
  [TokenType.GREATER, ">"],
  [TokenType.LESSEQUAL, "<="],
  [TokenType.GREATEREQUAL, ">="],
  [TokenType.DOUBLEEQUAL, "=="],
  [TokenType.NOTEQUAL, "!="],
]);

/**
 * AST-level abstract interpreter.
 *
 * Walks the Python AST with known argument types, propagates type/sign/truth info,
 * and annotates expression nodes in a WeakMap. Any backend compiler can then
 * read these annotations to emit specialized opcodes directly.
 */
export function specializeAST(
  body: StmtNS.Stmt[],
  bindings: TypeEnv,
  slotLookup: SlotLookup,
): AnalysisResult {
  const exprTypes: WeakMap<object, AbstractValue> = new WeakMap();
  // Convert Map to array at the boundary
  const slotTypes: (AbstractValue | undefined)[] = [];
  for (const [slot, val] of bindings) {
    slotTypes[slot] = val;
  }
  const visitor = new ASTSpecializationVisitor(exprTypes, slotTypes, slotLookup);
  visitor.visitStatements(body);
  return { exprTypes, inEnv: new WeakMap(), outEnv: new WeakMap() };
}

class ASTSpecializationVisitor {
  private exprTypes: WeakMap<object, AbstractValue>;
  private slotTypes: (AbstractValue | undefined)[];
  private slotLookup: SlotLookup;

  constructor(
    exprTypes: WeakMap<object, AbstractValue>,
    slotTypes: (AbstractValue | undefined)[],
    slotLookup: SlotLookup,
  ) {
    this.exprTypes = exprTypes;
    this.slotTypes = slotTypes;
    this.slotLookup = slotLookup;
  }

  private annotate(node: ExprNS.Expr, info: AbstractValue): AbstractValue {
    this.exprTypes.set(node, info);
    return info;
  }

  // ========================================================================
  // Statement visitors (update slotTypes, no return value)
  // ========================================================================

  visitStatements(stmts: StmtNS.Stmt[]): void {
    for (const stmt of stmts) {
      this.visitStmt(stmt);
    }
  }

  private visitStmt(stmt: StmtNS.Stmt): void {
    if (stmt instanceof StmtNS.Assign) {
      this.visitAssign(stmt);
    } else if (stmt instanceof StmtNS.Return) {
      this.visitReturn(stmt);
    } else if (stmt instanceof StmtNS.If) {
      this.visitIf(stmt);
    } else if (stmt instanceof StmtNS.While) {
      this.visitWhile(stmt);
    } else if (stmt instanceof StmtNS.For) {
      this.visitFor(stmt);
    } else if (stmt instanceof StmtNS.FunctionDef) {
      // Don't descend into nested function bodies — they get their own specialization
      return;
    } else if (stmt instanceof StmtNS.SimpleExpr) {
      this.visitExpr(stmt.expression);
    } else if (stmt instanceof StmtNS.FileInput) {
      this.visitStatements(stmt.statements);
    }
    // Pass, Indent, Dedent, Global, NonLocal, Break, Continue — no type effects
  }

  private visitAssign(stmt: StmtNS.Assign): void {
    const valueInfo = this.visitExpr(stmt.value);
    const info = this.slotLookup((stmt.target as ExprNS.Variable).name);
    if (!info.isPrimitive && info.envLevel === 0) {
      this.slotTypes[info.slot] = valueInfo;
    }
  }

  private visitReturn(stmt: StmtNS.Return): void {
    if (stmt.value) {
      this.visitExpr(stmt.value);
    }
  }

  private visitIf(stmt: StmtNS.If): void {
    this.visitExpr(stmt.condition);

    const saved = this.slotTypes.slice();

    this.visitStatements(stmt.body);
    const trueSlots = this.slotTypes;

    this.slotTypes = saved;
    if (stmt.elseBlock) {
      this.visitStatements(stmt.elseBlock);
    }
    const falseSlots = this.slotTypes;

    const len = Math.max(trueSlots.length, falseSlots.length);
    const joined = new Array<AbstractValue | undefined>(len);
    for (let i = 0; i < len; i++) {
      const t = trueSlots[i], f = falseSlots[i];
      if (t !== undefined && f !== undefined) {
        joined[i] = join(t, f);
      } else {
        joined[i] = t ?? f;
      }
    }
    this.slotTypes = joined;
  }

  private visitWhile(stmt: StmtNS.While): void {
    this.visitExpr(stmt.condition);
    this.visitStatements(stmt.body);
  }

  private visitFor(stmt: StmtNS.For): void {
    this.visitExpr(stmt.iter);
    // Loop variable is unknown type (could be anything from the iterator)
    const info = this.slotLookup(stmt.target);
    if (!info.isPrimitive && info.envLevel === 0) {
      this.slotTypes[info.slot] = TOP;
    }
    this.visitStatements(stmt.body);
  }

  // ========================================================================
  // Expression visitors (return AbstractValue, annotate the node)
  // ========================================================================

  visitExpr(expr: ExprNS.Expr): AbstractValue {
    if (expr instanceof ExprNS.Literal) {
      return this.visitLiteral(expr);
    } else if (expr instanceof ExprNS.BigIntLiteral) {
      return this.visitBigIntLiteral(expr);
    } else if (expr instanceof ExprNS.Variable) {
      return this.visitVariable(expr);
    } else if (expr instanceof ExprNS.Binary) {
      return this.visitBinary(expr);
    } else if (expr instanceof ExprNS.Compare) {
      return this.visitCompare(expr);
    } else if (expr instanceof ExprNS.Unary) {
      return this.visitUnary(expr);
    } else if (expr instanceof ExprNS.BoolOp) {
      return this.visitBoolOp(expr);
    } else if (expr instanceof ExprNS.Ternary) {
      return this.visitTernary(expr);
    } else if (expr instanceof ExprNS.Call) {
      return this.visitCall(expr);
    } else if (expr instanceof ExprNS.Grouping) {
      return this.visitExpr(expr.expression);
    } else if (expr instanceof ExprNS.Lambda || expr instanceof ExprNS.MultiLambda) {
      return this.annotate(expr, closureValue());
    } else if (expr instanceof ExprNS.None) {
      return this.annotate(expr, nullValue());
    } else if (expr instanceof ExprNS.List) {
      // Visit elements but list itself is TOP
      for (const el of expr.elements) {
        this.visitExpr(el);
      }
      return this.annotate(expr, TOP);
    } else if (expr instanceof ExprNS.Subscript) {
      this.visitExpr(expr.value);
      this.visitExpr(expr.index);
      return this.annotate(expr, TOP);
    }
    return TOP;
  }

  private visitLiteral(expr: ExprNS.Literal): AbstractValue {
    const value = expr.value;
    if (typeof value === "number") {
      const info = value > 0 ? positiveInteger() : value < 0 ? negativeInteger() : zeroInteger();
      return this.annotate(expr, info);
    } else if (typeof value === "boolean") {
      return this.annotate(expr, value ? trueValue() : falseValue());
    } else if (typeof value === "string") {
      return this.annotate(expr, stringValue());
    }
    return this.annotate(expr, TOP);
  }

  private visitBigIntLiteral(expr: ExprNS.BigIntLiteral): AbstractValue {
    const n = Number(expr.value);
    const info = n > 0 ? positiveInteger() : n < 0 ? negativeInteger() : zeroInteger();
    return this.annotate(expr, info);
  }

  private visitVariable(expr: ExprNS.Variable): AbstractValue {
    const info = this.slotLookup(expr.name);
    if (info.isPrimitive) {
      return this.annotate(expr, TOP);
    }
    if (info.envLevel === 0) {
      const slotInfo = this.slotTypes[info.slot] ?? TOP;
      return this.annotate(expr, slotInfo);
    }
    // Parent env variables are conservatively TOP
    return this.annotate(expr, TOP);
  }

  private visitBinary(expr: ExprNS.Binary): AbstractValue {
    const left = this.visitExpr(expr.left);
    const right = this.visitExpr(expr.right);

    const opStr = BINARY_OP_MAP.get(expr.operator.type);
    if (opStr !== undefined) {
      const result = transferBinaryOp(opStr, left, right);
      return this.annotate(expr, result);
    }

    // String concatenation: if both are string kind only
    if (
      expr.operator.type === TokenType.PLUS &&
      left.sound.kinds === STR_BIT &&
      right.sound.kinds === STR_BIT
    ) {
      return this.annotate(expr, stringValue());
    }

    return this.annotate(expr, TOP);
  }

  private visitCompare(expr: ExprNS.Compare): AbstractValue {
    const left = this.visitExpr(expr.left);
    const right = this.visitExpr(expr.right);

    const opStr = COMPARE_OP_MAP.get(expr.operator.type);
    if (opStr !== undefined) {
      const result = transferCompare(opStr, left, right);
      return this.annotate(expr, result);
    }

    return this.annotate(expr, booleanValue(BoolRef.Top));
  }

  private visitUnary(expr: ExprNS.Unary): AbstractValue {
    const operand = this.visitExpr(expr.right);

    switch (expr.operator.type) {
      case TokenType.MINUS:
        return this.annotate(expr, transferUnaryNeg(operand));
      case TokenType.NOT:
        return this.annotate(expr, transferNot(operand));
      case TokenType.PLUS:
        // Unary plus passes through
        return this.annotate(expr, operand);
      default:
        return this.annotate(expr, TOP);
    }
  }

  private visitBoolOp(expr: ExprNS.BoolOp): AbstractValue {
    const left = this.visitExpr(expr.left);
    const right = this.visitExpr(expr.right);

    const leftIsBool = left.sound.kinds === BOOL_BIT;

    if (expr.operator.type === TokenType.AND) {
      // Short-circuit: if left is always false, result is false
      if (leftIsBool && left.sound.boolRef === BoolRef.False) {
        return this.annotate(expr, falseValue());
      }
      if (leftIsBool && left.sound.boolRef === BoolRef.True) {
        return this.annotate(expr, right);
      }
      return this.annotate(expr, booleanValue(BoolRef.Top));
    } else if (expr.operator.type === TokenType.OR) {
      if (leftIsBool && left.sound.boolRef === BoolRef.True) {
        return this.annotate(expr, trueValue());
      }
      if (leftIsBool && left.sound.boolRef === BoolRef.False) {
        return this.annotate(expr, right);
      }
      return this.annotate(expr, booleanValue(BoolRef.Top));
    }

    return this.annotate(expr, TOP);
  }

  private visitTernary(expr: ExprNS.Ternary): AbstractValue {
    this.visitExpr(expr.predicate);
    this.visitExpr(expr.consequent);
    this.visitExpr(expr.alternative);
    // Conservative: can't know which branch is taken without constant folding
    return this.annotate(expr, TOP);
  }

  private visitCall(expr: ExprNS.Call): AbstractValue {
    // Visit callee and args for their side effects on slot types
    this.visitExpr(expr.callee);
    for (const arg of expr.args) {
      this.visitExpr(arg);
    }
    // Can't infer return types of user functions
    return this.annotate(expr, TOP);
  }
}
