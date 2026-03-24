import { ExprNS, StmtNS } from "../../ast-types";
import { TokenType } from "../../tokens";
import type { AbstractValue } from "../../types/abstract-value";
import { INT_BIT, BOOL_BIT, BoolRef, IntRef } from "../../types/abstract-value";
import type { BackwardsBindings } from "../backwards-bindings";
import {
  ALLOC_ENV_FX,
  APPLY_FX_NAME,
  applyFuncFactory,
  ARITHMETIC_OP_FX,
  ARITHMETIC_OP_TAG,
  BOOL_NOT_FX,
  FAST_INT_ADD_FX,
  FAST_INT_DIV_FX,
  FAST_INT_MOD_FX,
  FAST_INT_MUL_FX,
  FAST_INT_SUB_FX,
  GENERIC_FLOOR_MOD_FX,
  FAST_INT_EQ_FX,
  FAST_INT_NEQ_FX,
  FAST_INT_LT_FX,
  FAST_INT_LTE_FX,
  FAST_INT_GT_FX,
  FAST_INT_GTE_FX,
  FAST_BOOL_NOT_FX,
  FAST_INT_NEG_FX,
  BOOLISE_FX,
  COMPARISON_OP_FX,
  COMPARISON_OP_TAG,
  CURR_ENV,
  GET_LEX_ADDR_FX,
  GET_PAIR_HEAD_FX,
  GET_PAIR_TAIL_FX,
  HEAP_PTR,
  importedLogs,
  LOG_FX,
  MAKE_BOOL_FX,
  MAKE_CLOSURE_FX,
  MAKE_COMPLEX_FX,
  MAKE_FLOAT_FX,
  MAKE_INT_FX,
  MAKE_NONE_FX,
  MAKE_PAIR_FX,
  MAKE_STRING_FX,
  nativeFunctions,
  NEG_FX,
  PRE_APPLY_FX,
  SET_LEX_ADDR_FX,
  SET_PAIR_HEAD_FX,
  SET_PAIR_TAIL_FX,
  SET_PARAM_FX,
  TYPE_TAG,
} from "./constants";
import { f64, global, i32, i64, local, memory, mut, wasm } from "@sourceacademy/wasm-util";
import {
  WasmCall,
  WasmExport,
  WasmInstruction,
  WasmNumeric,
  WasmRaw,
} from "@sourceacademy/wasm-util";
import { MAX_PARAMS_TRACKED, PROFILING_SENTINEL } from "./wasm-profiling";

type BuiltInDef = {
  arity: number;
  body: WasmInstruction | WasmInstruction[];
  isVoid: boolean;
};

const builtInFunctions = new Map<string, BuiltInDef>([
  [
    "print",
    {
      arity: 1,
      body: wasm.call(LOG_FX).args(wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(0))),
      isVoid: true,
    },
  ],
  [
    "pair",
    {
      arity: 2,
      body: wasm
        .call(MAKE_PAIR_FX)
        .args(
          wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(0)),
          wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(1)),
        ),
      isVoid: false,
    },
  ],
  [
    "head",
    {
      arity: 1,
      body: wasm
        .call(GET_PAIR_HEAD_FX)
        .args(wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(0))),
      isVoid: false,
    },
  ],
  [
    "tail",
    {
      arity: 1,
      body: wasm
        .call(GET_PAIR_TAIL_FX)
        .args(wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(0))),
      isVoid: false,
    },
  ],
  [
    "set_head",
    {
      arity: 2,
      body: wasm
        .call(SET_PAIR_HEAD_FX)
        .args(
          wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(0)),
          wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(1)),
        ),
      isVoid: true,
    },
  ],
  [
    "set_tail",
    {
      arity: 2,
      body: wasm
        .call(SET_PAIR_TAIL_FX)
        .args(
          wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(0)),
          wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(1)),
        ),
      isVoid: true,
    },
  ],
  [
    "bool",
    {
      arity: 1,
      body: [
        i32.const(TYPE_TAG.BOOL),
        wasm.call(BOOLISE_FX).args(wasm.call(GET_LEX_ADDR_FX).args(i32.const(0), i32.const(0))),
      ],
      isVoid: false,
    },
  ],
]);

type Binding = { name: string; tag: "local" | "nonlocal" };

interface BuilderVisitor<S, E> extends StmtNS.Visitor<S>, ExprNS.Visitor<E> {
  visit(stmt: StmtNS.Stmt): S;
  visit(stmt: ExprNS.Expr): E;
  visit(stmt: StmtNS.Stmt | ExprNS.Expr): S | E;
}

function notImplemented(name: string): never {
  throw new Error(`BuilderGenerator: ${name} not implemented`);
}

export class BuilderGenerator implements BuilderVisitor<WasmInstruction, WasmNumeric> {
  private strings: [string, number][] = [];
  private heapPointer = 0;

  private environment: Binding[][] = [[]];
  private userFunctions: WasmInstruction[][] = [];

  // Optional type annotations from profiling. When present, used to emit
  // specialized WAT instructions that bypass runtime type dispatch.
  private typeAnnotations: WeakMap<object, AbstractValue> | null = null;

  private profilingEnabled = false;
  private bindings: BackwardsBindings<number> | null = null;
  private readonly funcArities: number[] = [];

  /**
   * Set type annotations for specialized code generation.
   * Returns this for fluent use: new BuilderGenerator().withAnnotations(map).visit(ast).
   */
  withAnnotations(typeAnnotations: WeakMap<object, AbstractValue>): this {
    this.typeAnnotations = typeAnnotations;
    return this;
  }

  /** Returns the static TYPE_TAG if the annotation is exactly INT_BIT or BOOL_BIT, else null. */
  private resolveStaticTag(ann: AbstractValue | undefined): number | null {
    if (!ann) return null;
    if (ann.sound.kinds === INT_BIT) return TYPE_TAG.INT;
    if (ann.sound.kinds === BOOL_BIT) return TYPE_TAG.BOOL;
    return null;
  }

  /**
   * Returns true if the abstract value guarantees a non-negative payload.
   * BOOL_BIT payloads are always 0 or 1.
   * INT_BIT payloads are non-negative when IntRef has no Neg bit set.
   */
  private isNonNeg(ann: AbstractValue): boolean {
    if (ann.sound.kinds === BOOL_BIT) return true;
    if (ann.sound.kinds === INT_BIT) {
      if (ann.sound.intRef === IntRef.Bottom) return false; // Bottom is unreachable; treat conservatively
      return (ann.sound.intRef & IntRef.Neg) === 0;
    }
    return false;
  }

  /**
   * Enable profiling instrumentation. Returns this for fluent use.
   * When enabled, emits a $_profiling_base global and memory.fill sentinel
   * initialization in $main, plus per-param type-tag stores at the top of
   * each user-defined function body.
   *
   * Note: calling this without also calling withProfiling() enables WAT
   * instrumentation but leaves bindings null — buildWasmModule will return
   * bindings: null and collectTypeInfo() will return an empty map. Prefer
   * withProfiling() for the full profiling pipeline.
   */
  withProfilingEnabled(): this {
    this.profilingEnabled = true;
    return this;
  }

  /**
   * Wire a BackwardsBindings instance into this generator. During visit(),
   * each user-defined function (FunctionDef or Lambda) will be registered
   * with its local index (0 = first user function, excluding builtins).
   * Also enables profiling instrumentation.
   */
  withProfiling(bindings: BackwardsBindings<number>): this {
    this.bindings = bindings;
    this.profilingEnabled = true;
    return this;
  }

  /**
   * Return the recorded arity for each user-defined function slot in definition
   * order (builtins are excluded). Index 0 = first user-defined function.
   * Only meaningful after visit().
   */
  getFuncArities(): number[] {
    return [...this.funcArities.slice(builtInFunctions.size)];
  }

  private getLexAddress(name: string): [number, number] {
    for (let i = this.environment.length - 1; i >= 0; i--) {
      const curr = this.environment[i];
      const index = curr.findIndex(b => b.name === name);

      if (index === -1) continue;

      if (curr[index].tag === "nonlocal") {
        throw new Error(`Name ${curr[index].name} is used prior to nonlocal declaration`);
      }

      return [this.environment.length - 1 - i, index];
    }
    throw new Error(`Name ${name} not defined!`);
  }

  private collectDeclarations(
    statements: StmtNS.Stmt[],
    parameters?: StmtNS.FunctionDef["parameters"],
  ): Binding[] {
    const findInNestedBody = (stmts: StmtNS.Stmt[]): (StmtNS.FunctionDef | StmtNS.Assign)[] => {
      const found: (StmtNS.FunctionDef | StmtNS.Assign)[] = [];
      for (const stmt of stmts) {
        if (stmt instanceof StmtNS.FunctionDef || stmt instanceof StmtNS.Assign) {
          found.push(stmt);
        } else if (stmt instanceof StmtNS.If) {
          found.push(...findInNestedBody(stmt.body));
          if (stmt.elseBlock) {
            found.push(...findInNestedBody(stmt.elseBlock));
          }
        } else if (stmt instanceof StmtNS.While || stmt instanceof StmtNS.For) {
          found.push(...findInNestedBody(stmt.body));
        }
      }
      return found;
    };

    const bindings: Binding[] = findInNestedBody(statements).map(s => {
      if (s instanceof StmtNS.FunctionDef) {
        return { name: s.name.lexeme, tag: "local" };
      }

      if (s.target instanceof ExprNS.Subscript) {
        throw new Error("Subscript assignment is not yet supported");
      }

      return { name: s.target.name.lexeme, tag: "local" };
    });

    statements
      .filter(s => s instanceof StmtNS.NonLocal)
      .map(s => s.name.lexeme)
      .forEach(name => {
        // nonlocal declaration must exist in a nonlocal scope
        if (
          !this.environment.find(
            (frame, i) => i !== 0 && frame.find(binding => binding.name === name),
          )
        )
          throw new Error(`No binding for nonlocal ${name} found!`);

        // cannot declare parameter name as nonlocal
        if (parameters && parameters.map(p => p.lexeme).includes(name)) {
          throw new Error(`${name} is parameter and nonlocal`);
        }

        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          if (binding.name === name) {
            // tag this binding as nonlocal so
            // if it's accessed before its nonlocal statement,
            // throw error
            bindings[i].tag = "nonlocal";
          }
        }
      });

    return [
      ...(parameters?.map(p => ({ name: p.lexeme, tag: "local" as const })) ?? []),
      ...bindings,
    ];
  }

  visit(stmt: StmtNS.Stmt): WasmInstruction;
  visit(stmt: ExprNS.Expr): WasmNumeric;
  visit(stmt: StmtNS.Stmt | ExprNS.Expr): WasmInstruction | WasmNumeric {
    return stmt.accept(this);
  }

  visitFileInputStmt(stmt: StmtNS.FileInput): WasmInstruction {
    if (stmt.statements.length <= 0) {
      console.log("No statements found");
      throw new Error("No statements found");
    }

    // declare built-in functions in the global environment before user code
    const builtInFuncsDeclarations = Array.from(builtInFunctions.entries()).map(
      ([name, { arity, body, isVoid }], i) => {
        this.environment[0].push({ name, tag: "local" });
        const tag = this.userFunctions.length;
        this.funcArities[tag] = arity;
        const newBody = [
          ...(Array.isArray(body) ? body : [body]),
          wasm.return(
            ...(isVoid ? [wasm.call(MAKE_NONE_FX)] : []),
            global.set(CURR_ENV, local.get("$return_env")),
          ),
        ];
        this.userFunctions.push(newBody);

        return wasm
          .call(SET_LEX_ADDR_FX)
          .args(
            i32.const(0),
            i32.const(i),
            wasm
              .call(MAKE_CLOSURE_FX)
              .args(i32.const(tag), i32.const(arity), i32.const(arity), global.get(CURR_ENV)),
          );
      },
    );

    this.environment[0].push(...this.collectDeclarations(stmt.statements));

    const body = stmt.statements.map(s => this.visit(s));

    // Apply profiling instrumentation to user function bodies now that all
    // functions have been visited and their arities are known.
    let profilingBaseAddr = 0;
    let profilingRegionSize = 0;
    if (this.profilingEnabled) {
      const numUserFuncs = this.userFunctions.length;
      const numTrackedFunctions = numUserFuncs - builtInFunctions.size;
      profilingRegionSize = numTrackedFunctions * MAX_PARAMS_TRACKED * 4;
      profilingBaseAddr = 65_536 - profilingRegionSize;

      if (profilingBaseAddr < this.heapPointer) {
        throw new Error(
          `Profiling buffer would overlap heap: base=${profilingBaseAddr}, heapPointer=${this.heapPointer}`,
        );
      }

      for (let fi = builtInFunctions.size; fi < numUserFuncs; fi++) {
        const localIndex = fi - builtInFunctions.size;
        const arity = this.funcArities[fi] ?? 0;
        if (arity > 0) {
          const instrBlock = buildProfilingInstrumentation(localIndex, arity, profilingBaseAddr);
          this.userFunctions[fi] = [...instrBlock, ...this.userFunctions[fi]];
        }
      }
    }

    // this matches the format of drop in visitSimpleExpr
    const lastInstr = body.at(-1);
    const undroppedInstr =
      lastInstr?.op === "drop" && lastInstr.value?.op === "drop" && lastInstr.value.value;

    // collect all strings, native functions used and user functions
    const strings = this.strings.map(([str, add]) => wasm.data(i32.const(add), str));

    const applyFunction = applyFuncFactory(this.userFunctions);

    // because each variable has a tag and payload = 3 words
    const globalEnvLength = this.environment[0].length;

    // Build up the list of globals conditionally.
    // Note: wasm-util wraps the value type in parens, generating (global $name (i32) ...),
    // which is invalid WAT. Using mut.i32 generates (global $name (mut i32) ...) which is
    // valid. The global is never mutated by the Wasm code, so mut is functionally harmless.
    const extraGlobals = this.profilingEnabled
      ? [wasm.global("$_profiling_base", mut.i32).init(i32.const(profilingBaseAddr))]
      : [];

    // Build up the list of extra exports conditionally.
    // WasmRaw is a valid WasmInstruction that WatGenerator handles, so we cast
    // it to WasmExport to satisfy the .exports() type signature.
    // TODO: wasm-util does not provide a typed API for raw global exports.
    // This cast is required until the upstream library supports it.
    const extraExports = this.profilingEnabled
      ? [wasm.raw`(export "profiling_base" (global $_profiling_base))` as unknown as WasmExport]
      : [];

    const moduleBuilder = wasm
      .module()
      .imports(wasm.import("js", "memory").memory(1), ...importedLogs)
      .globals(
        wasm.global(HEAP_PTR, mut.i32).init(i32.const(this.heapPointer)),
        wasm.global(CURR_ENV, mut.i32).init(i32.const(0)),
        ...extraGlobals,
      )
      .datas(...strings)
      .funcs(
        ...nativeFunctions,
        applyFunction,

        wasm
          .func("$main")
          .results(...(undroppedInstr ? [i32, i64] : []))
          .body(
            ...(this.profilingEnabled
              ? [
                  memory.fill(
                    i32.const(profilingBaseAddr),
                    i32.const(PROFILING_SENTINEL),
                    i32.const(profilingRegionSize),
                  ),
                ]
              : []),

            global.set(
              CURR_ENV,
              wasm.call(ALLOC_ENV_FX).args(i32.const(globalEnvLength), i32.const(0), i32.const(0)),
            ),

            ...builtInFuncsDeclarations,

            ...(undroppedInstr ? [...body.slice(0, -1), undroppedInstr] : body),
          ),
      )
      .exports(wasm.export("main").func("$main"), ...extraExports);

    return moduleBuilder.build();
  }

  visitSimpleExprStmt(stmt: StmtNS.SimpleExpr): WasmInstruction {
    const expr = this.visit(stmt.expression);
    return wasm.drop(wasm.drop(expr));
  }

  visitGroupingExpr(expr: ExprNS.Grouping): WasmNumeric {
    return this.visit(expr.expression);
  }

  visitBinaryExpr(expr: ExprNS.Binary): WasmNumeric {
    const left = this.visit(expr.left);
    const right = this.visit(expr.right);

    const type = expr.operator.type;
    let opTag: number;
    if (type === TokenType.PLUS) opTag = ARITHMETIC_OP_TAG.ADD;
    else if (type === TokenType.MINUS) opTag = ARITHMETIC_OP_TAG.SUB;
    else if (type === TokenType.STAR) opTag = ARITHMETIC_OP_TAG.MUL;
    else if (type === TokenType.SLASH) opTag = ARITHMETIC_OP_TAG.DIV;
    else if (type === TokenType.PERCENT) opTag = ARITHMETIC_OP_TAG.MOD;
    else throw new Error(`Unsupported binary operator: ${type}`);

    // Fast path: if both operands are provably integers OR booleans, skip runtime
    // type dispatch. Booleans are safe here because:
    //   - Bool i64 payloads are always 0 or 1 (invariant maintained by MAKE_BOOL_FX).
    //   - The FAST_INT_* helpers ignore input tags and just operate on the i64 values.
    //   - All arithmetic on booleans returns INT in Python (True+True=2), so tagging
    //     the result with INT_TAG (which the fast helpers do) is correct.
    //
    // PROTOTYPE NOTE on modulo (FAST_INT_MOD_FX / PERCENT):
    //   The fast path uses i64.rem_s which implements C-style truncated remainder.
    //   This diverges from Python floor-division semantics for negative operands:
    //     Python: -7 % 3 = 2   (result sign = divisor sign)
    //     Wasm:   -7 % 3 = -1  (result sign = dividend sign)
    //   For BOOL_BIT operands (values 0 or 1) this is never a problem — booleans
    //   are always non-negative. For INT_BIT operands it IS a concern unless the
    //   lattice can prove both operands are non-negative (IntRef.NonNeg / IntRef.Pos).
    //   The fast path is included here as a prototype; a production implementation
    //   should guard on IntRef before enabling the modulo fast path for ints.
    // Hoist annotation lookups so they are accessible both inside and outside
    // the typeAnnotations block (needed by the modulo block below).
    const leftAnn = this.typeAnnotations?.get(expr.left);
    const rightAnn = this.typeAnnotations?.get(expr.right);
    const leftIsIntOrBool =
      leftAnn !== undefined &&
      (leftAnn.sound.kinds === INT_BIT || leftAnn.sound.kinds === BOOL_BIT);
    const rightIsIntOrBool =
      rightAnn !== undefined &&
      (rightAnn.sound.kinds === INT_BIT || rightAnn.sound.kinds === BOOL_BIT);

    if (this.typeAnnotations) {
      if (leftIsIntOrBool && rightIsIntOrBool) {
        // MOD is handled separately below for floor-mod semantics.
        if (opTag !== ARITHMETIC_OP_TAG.MOD) {
          const fastFx =
            opTag === ARITHMETIC_OP_TAG.ADD
              ? FAST_INT_ADD_FX
              : opTag === ARITHMETIC_OP_TAG.SUB
                ? FAST_INT_SUB_FX
                : opTag === ARITHMETIC_OP_TAG.MUL
                  ? FAST_INT_MUL_FX
                  : FAST_INT_DIV_FX;
          // The fast functions return (i32, i64) — same shape as ARITHMETIC_OP_FX.
          return wasm.call(fastFx).args(left, right);
        }
      }
    }

    // Modulo: FAST_INT_MOD_FX uses truncated remainder (C-style), safe only for non-negative
    // operands. For signed INT_BIT, use GENERIC_FLOOR_MOD_FX (Python floor semantics).
    if (opTag === ARITHMETIC_OP_TAG.MOD) {
      if (leftIsIntOrBool && rightIsIntOrBool) {
        if (this.isNonNeg(leftAnn) && this.isNonNeg(rightAnn)) {
          return wasm.call(FAST_INT_MOD_FX).args(left, right);
        }
        return wasm.call(GENERIC_FLOOR_MOD_FX).args(left, right);
      }
      // Fall through to generic ARITHMETIC_OP_FX below
    }

    return wasm.call(ARITHMETIC_OP_FX).args(left, right, i32.const(opTag));
  }

  visitCompareExpr(expr: ExprNS.Compare): WasmNumeric {
    // Phase 1: constant fold — if the lattice resolved this comparison to a definite bool.
    // Operands are visited (return values discarded) for annotation bookkeeping consistency.
    if (this.typeAnnotations) {
      const ann = this.typeAnnotations.get(expr);
      if (ann !== undefined && ann.sound.kinds === BOOL_BIT) {
        if (ann.sound.boolRef === BoolRef.True) {
          this.visit(expr.left);
          this.visit(expr.right);
          return wasm.call(MAKE_BOOL_FX).args(i32.const(1));
        } else if (ann.sound.boolRef === BoolRef.False) {
          this.visit(expr.left);
          this.visit(expr.right);
          return wasm.call(MAKE_BOOL_FX).args(i32.const(0));
        }
        // BoolRef.Top or BoolRef.Bottom — fall through.
      }
    }

    const left = this.visit(expr.left);
    const right = this.visit(expr.right);

    const type = expr.operator.type;
    let opTag: number;
    if (type === TokenType.DOUBLEEQUAL) opTag = COMPARISON_OP_TAG.EQ;
    else if (type === TokenType.NOTEQUAL) opTag = COMPARISON_OP_TAG.NEQ;
    else if (type === TokenType.LESS) opTag = COMPARISON_OP_TAG.LT;
    else if (type === TokenType.LESSEQUAL) opTag = COMPARISON_OP_TAG.LTE;
    else if (type === TokenType.GREATER) opTag = COMPARISON_OP_TAG.GT;
    else if (type === TokenType.GREATEREQUAL) opTag = COMPARISON_OP_TAG.GTE;
    else throw new Error(`Unsupported comparison operator: ${type}`);

    // Phase 2: fast path — both operands have a static (INT_BIT or BOOL_BIT) type.
    // Skips COMPARISON_OP_FX's tag-check + br_table dispatch.
    if (this.typeAnnotations) {
      const leftAnn = this.typeAnnotations.get(expr.left);
      const rightAnn = this.typeAnnotations.get(expr.right);
      if (this.resolveStaticTag(leftAnn) !== null && this.resolveStaticTag(rightAnn) !== null) {
        const fastFx =
          opTag === COMPARISON_OP_TAG.EQ
            ? FAST_INT_EQ_FX
            : opTag === COMPARISON_OP_TAG.NEQ
              ? FAST_INT_NEQ_FX
              : opTag === COMPARISON_OP_TAG.LT
                ? FAST_INT_LT_FX
                : opTag === COMPARISON_OP_TAG.LTE
                  ? FAST_INT_LTE_FX
                  : opTag === COMPARISON_OP_TAG.GT
                    ? FAST_INT_GT_FX
                    : FAST_INT_GTE_FX;
        return wasm.call(fastFx).args(left, right);
      }
    }

    // Generic fallback.
    return wasm.call(COMPARISON_OP_FX).args(left, right, i32.const(opTag));
  }

  visitUnaryExpr(expr: ExprNS.Unary): WasmNumeric {
    const right = this.visit(expr.right);
    const type = expr.operator.type;

    if (this.typeAnnotations) {
      const ann = this.typeAnnotations.get(expr.right);
      // Fast bool NOT: flips 0→1 and 1→0 without runtime type dispatch.
      if (type === TokenType.NOT && ann !== undefined && ann.sound.kinds === BOOL_BIT) {
        return wasm.call(FAST_BOOL_NOT_FX).args(right);
      }
      // Fast int NEG: two's-complement negation without runtime type dispatch.
      if (type === TokenType.MINUS && ann !== undefined && ann.sound.kinds === INT_BIT) {
        return wasm.call(FAST_INT_NEG_FX).args(right);
      }
    }

    if (type === TokenType.MINUS) return wasm.call(NEG_FX).args(right);
    else if (type === TokenType.NOT) return wasm.call(BOOL_NOT_FX).args(right);
    else throw new Error(`Unsupported unary operator: ${type}`);
  }

  visitBoolOpExpr(expr: ExprNS.BoolOp): WasmNumeric {
    const left = this.visit(expr.left);
    const right = this.visit(expr.right);

    const type = expr.operator.type;

    // not a wasm function as it needs to short-circuit
    if (type === TokenType.AND) {
      // if x is false, then x else y
      return (
        wasm
          .if(i64.eqz(wasm.call(BOOLISE_FX).args(left)))
          .results(i32, i64)
          .then(left)
          // wasm.if().results(i32, i64).then().else() produces the correct (i32 tag, i64 payload)
          // shape at runtime, but the builder types the result as WasmInstruction. Cast is safe.
          .else(right) as unknown as WasmNumeric
      );
    } else if (type === TokenType.OR) {
      // if x is false, then y else x
      return (
        wasm
          .if(i64.eqz(wasm.call(BOOLISE_FX).args(left)))
          .results(i32, i64)
          .then(right)
          // wasm.if().results(i32, i64).then().else() produces the correct (i32 tag, i64 payload)
          // shape at runtime, but the builder types the result as WasmInstruction. Cast is safe.
          .else(left) as unknown as WasmNumeric
      );
    } else throw new Error(`Unsupported boolean binary operator: ${type}`);
  }

  visitTernaryExpr(expr: ExprNS.Ternary): WasmNumeric {
    const consequent = this.visit(expr.consequent);
    const alternative = this.visit(expr.alternative);

    const predicate = this.visit(expr.predicate);

    return (
      wasm
        .if(i32.wrap_i64(wasm.call(BOOLISE_FX).args(predicate)))
        .results(i32, i64)
        .then(consequent)
        // wasm.if().results(i32, i64).then().else() produces the correct (i32 tag, i64 payload)
        // shape at runtime, but the builder types the result as WasmInstruction. Cast is safe.
        .else(alternative) as unknown as WasmNumeric
    );
  }

  visitNoneExpr(expr: ExprNS.None): WasmNumeric {
    return wasm.call(MAKE_NONE_FX);
  }

  visitBigIntLiteralExpr(expr: ExprNS.BigIntLiteral): WasmNumeric {
    const value = BigInt(expr.value);
    const min = BigInt("-9223372036854775808"); // -(2^63)
    const max = BigInt("9223372036854775807"); // (2^63) - 1
    if (value < min || value > max) {
      throw new Error(`BigInt literal out of bounds: ${expr.value}`);
    }

    return wasm.call(MAKE_INT_FX).args(i64.const(value));
  }

  visitLiteralExpr(expr: ExprNS.Literal): WasmNumeric {
    if (typeof expr.value === "number") return wasm.call(MAKE_FLOAT_FX).args(f64.const(expr.value));
    else if (typeof expr.value === "boolean")
      return wasm.call(MAKE_BOOL_FX).args(i32.const(expr.value ? 1 : 0));
    else if (typeof expr.value === "string") {
      const str = expr.value;
      const len = str.length;
      const toReturn = wasm.call(MAKE_STRING_FX).args(i32.const(this.heapPointer), i32.const(len));

      this.strings.push([str, this.heapPointer]);
      this.heapPointer += len;
      return toReturn;
    } else {
      throw new Error(`Unsupported literal type: ${typeof expr.value}`);
    }
  }

  visitComplexExpr(expr: ExprNS.Complex): WasmNumeric {
    // expr.value is a PyComplexNumber with .real and .imag properties.
    const real = expr.value.real;
    const imag = expr.value.imag;

    return wasm.call(MAKE_COMPLEX_FX).args(f64.const(real), f64.const(imag));
  }

  visitAssignStmt(stmt: StmtNS.Assign): WasmInstruction {
    if (stmt.target instanceof ExprNS.Subscript) {
      throw new Error("Subscript assignment is not yet supported");
    }
    const [depth, index] = this.getLexAddress(stmt.target.name.lexeme);
    const expression = this.visit(stmt.value);

    return wasm.call(SET_LEX_ADDR_FX).args(i32.const(depth), i32.const(index), expression);
  }

  visitVariableExpr(expr: ExprNS.Variable): WasmNumeric {
    const [depth, index] = this.getLexAddress(expr.name.lexeme);
    return wasm.call(GET_LEX_ADDR_FX).args(i32.const(depth), i32.const(index));
  }

  visitFunctionDefStmt(stmt: StmtNS.FunctionDef): WasmInstruction {
    const [depth, index] = this.getLexAddress(stmt.name.lexeme);
    const arity = stmt.parameters.length;
    const tag = this.userFunctions.length;
    this.userFunctions.push([]); // placeholder
    this.funcArities[tag] = arity;
    if (this.bindings) {
      this.bindings.register(stmt, tag - builtInFunctions.size);
    }

    const newFrame = this.collectDeclarations(stmt.body, stmt.parameters);

    if (tag >= 1 << 16) throw new Error("Tag cannot be above 16-bit integer limit");
    if (arity >= 1 << 8) throw new Error("Arity cannot be above 8-bit integer limit");
    if (newFrame.length > 1 << 8)
      throw new Error("Environment length cannot be above 8-bit integer limit");

    this.environment.push(newFrame);
    const body = stmt.body.map(s => this.visit(s));
    this.environment.pop();

    this.userFunctions[tag] = body;

    return wasm
      .call(SET_LEX_ADDR_FX)
      .args(
        i32.const(depth),
        i32.const(index),
        wasm
          .call(MAKE_CLOSURE_FX)
          .args(i32.const(tag), i32.const(arity), i32.const(newFrame.length), global.get(CURR_ENV)),
      );
  }

  visitLambdaExpr(expr: ExprNS.Lambda): WasmNumeric {
    const arity = expr.parameters.length;
    const tag = this.userFunctions.length;
    this.userFunctions.push([]); // placeholder
    this.funcArities[tag] = arity;
    if (this.bindings) {
      this.bindings.register(expr, tag - builtInFunctions.size);
    }

    // no statements allowed in lambdas, so there won't be any new local declarations
    // other than parameters
    const newFrame = this.collectDeclarations([], expr.parameters);

    if (tag >= 1 << 16) throw new Error("Tag cannot be above 16-bit integer limit");
    if (arity >= 1 << 8) throw new Error("Arity cannot be above 8-bit integer limit");
    if (newFrame.length > 1 << 8)
      throw new Error("Environment length cannot be above 8-bit integer limit");

    this.environment.push(newFrame);
    const body = this.visit(expr.body);
    this.environment.pop();

    this.userFunctions[tag] = [wasm.return(body)];

    return wasm
      .call(MAKE_CLOSURE_FX)
      .args(i32.const(tag), i32.const(arity), i32.const(newFrame.length), global.get(CURR_ENV));
  }

  visitCallExpr(expr: ExprNS.Call): WasmRaw {
    const callee = this.visit(expr.callee);
    const args = expr.args.map(arg => this.visit(arg));

    // PRE_APPLY returns (1, 2) callee tag and value, (3) pointer to new environment
    // APPLY expects (1) pointer to return environment, (2, 3) callee tag and value

    // we call PRE_APPLY first, which verifies the callee is a closure and arity matches
    // AND creates a new environment for the function call, but does not set CURR_ENV yet
    // this is so that we can set the arguments in the new environment first

    // this means we can't use SET_LEX_ADDR_FX because it uses CURR_ENV internally
    // so we manually set the arguments in the new environment using SET_PARAM_FX

    // the SET_PARAM function returns the env address after setting the parameter
    // so we can chain the calls together
    return wasm.raw`
${global.get(CURR_ENV)}
${wasm.call(PRE_APPLY_FX).args(callee, i32.const(args.length))}

${args.map(
  (arg, i) =>
    wasm.raw`
(i32.const ${i}) ${arg} (call ${SET_PARAM_FX.name})`,
)}

(global.set ${CURR_ENV})
(call ${APPLY_FX_NAME})
`;
  }

  visitReturnStmt(stmt: StmtNS.Return): WasmInstruction {
    const value = stmt.value;

    return wasm.return(
      value ? this.visit(value) : wasm.call(MAKE_NONE_FX),
      global.set(CURR_ENV, local.get("$return_env")),
    );
  }

  visitNonLocalStmt(stmt: StmtNS.NonLocal): WasmInstruction {
    // because of this.collectDeclarations, this nonlocal declaration
    // is guaranteed to have a nonlocal (and not global) binding.

    // because of this.getLexAddress, it's also guaranteed to not have been
    // used illegally before this statement.

    // all that's left to do is remove the binding from the compile time environment
    // from here onwards (from the local frame).

    // if it doesn't exist in the local frame, do nothing as the statement has
    // no effect

    const currFrame = this.environment.at(-1);
    if (currFrame) {
      const bindingIndex = currFrame.findIndex(binding => binding.name === stmt.name.lexeme);

      if (bindingIndex >= 0) {
        currFrame.splice(bindingIndex, 1);
      }
    }

    return wasm.nop();
  }

  visitIfStmt(stmt: StmtNS.If): WasmInstruction {
    const condition = this.visit(stmt.condition);
    const body = stmt.body.map(b => this.visit(b));
    const elseBody = stmt.elseBlock?.map(e => this.visit(e));

    return elseBody
      ? wasm
          .if(i32.wrap_i64(wasm.call(BOOLISE_FX).args(condition)))
          .then(...body)
          .else(...elseBody)
      : wasm.if(i32.wrap_i64(wasm.call(BOOLISE_FX).args(condition))).then(...body);
  }

  visitPassStmt(stmt: StmtNS.Pass): WasmInstruction {
    return wasm.nop();
  }

  // UNIMPLEMENTED PYTHON CONSTRUCTS
  visitMultiLambdaExpr(expr: ExprNS.MultiLambda): WasmNumeric {
    // TODO: register MultiLambda nodes when visitMultiLambdaExpr is implemented
    return notImplemented("visitMultiLambdaExpr");
  }
  visitAnnAssignStmt(stmt: StmtNS.AnnAssign): WasmInstruction {
    return notImplemented("visitAnnAssignStmt");
  }
  visitBreakStmt(stmt: StmtNS.Break): WasmInstruction {
    return notImplemented("visitBreakStmt");
  }
  visitContinueStmt(stmt: StmtNS.Continue): WasmInstruction {
    return notImplemented("visitContinueStmt");
  }
  visitFromImportStmt(stmt: StmtNS.FromImport): WasmInstruction {
    return notImplemented("visitFromImportStmt");
  }
  visitGlobalStmt(stmt: StmtNS.Global): WasmInstruction {
    return notImplemented("visitGlobalStmt");
  }
  visitAssertStmt(stmt: StmtNS.Assert): WasmInstruction {
    return notImplemented("visitAssertStmt");
  }
  visitWhileStmt(stmt: StmtNS.While): WasmInstruction {
    return notImplemented("visitWhileStmt");
  }
  visitForStmt(stmt: StmtNS.For): WasmInstruction {
    return notImplemented("visitForStmt");
  }
  visitListExpr(expr: ExprNS.List): WasmNumeric {
    return notImplemented("visitListExpr");
  }
  visitSubscriptExpr(expr: ExprNS.Subscript): WasmNumeric {
    return notImplemented("visitSubscriptExpr");
  }
}

/**
 * Build WAT instrumentation instructions that, at the top of a function body,
 * store the type tag of each tracked parameter into the profiling memory region.
 *
 * For each param pi we emit (in linear WAT stack form):
 *   (i32.const byteOffset)
 *   (call $_get_lex_addr (i32.const 0) (i32.const pi))
 *   drop            ;; discard the i64 value result (leaves i32 tag on stack)
 *   i32.store       ;; stores tag at byteOffset
 *
 * Using wasm.raw allows us to express the multi-value drop cleanly without
 * introducing new locals into the function's local scope.
 */
function buildProfilingInstrumentation(
  funcIndex: number,
  arity: number,
  profilingBaseAddr: number,
): WasmInstruction[] {
  const tracked = Math.min(arity, MAX_PARAMS_TRACKED);
  const instrs: WasmInstruction[] = [];
  for (let pi = 0; pi < tracked; pi++) {
    const byteOffset = profilingBaseAddr + (funcIndex * MAX_PARAMS_TRACKED + pi) * 4;
    // GET_LEX_ADDR_FX returns (i32 tag, i64 value).
    // We push the store address, call to get both results, drop the i64,
    // then i32.store consumes address and the remaining i32 tag.
    instrs.push(
      wasm.raw`
(i32.const ${byteOffset})
(call ${GET_LEX_ADDR_FX.name} (i32.const 0) (i32.const ${pi}))
drop
i32.store`,
    );
  }
  return instrs;
}
