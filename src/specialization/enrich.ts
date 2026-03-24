import { StmtNS, ExprNS } from "../ast-types";
import type { AbstractValue, TypeEnv } from "../types/abstract-value";
import { join } from "../types/lattice-ops";
import { specializeAST } from "./specialize-ast";
import type {
  FunctionProfile,
  SlotLookup,
  SpecializableFunctionNode,
  TypeInformation,
} from "./types";
import { traverseAST } from "../validator/traverse";

// lambdaBodyCache is created per specialize() call to avoid memory leaks.
// (Module-level WeakMap would hold Return wrappers referencing Lambda tokens,
// preventing GC in long-lived JIT scenarios.)

/**
 * A FileInput enriched with per-expression type annotations from profiling.
 * Backends that support type-specialized code generation check this at compile time.
 * Backends that do not support it treat this as a plain FileInput.
 */
export class EnrichedFileInput extends StmtNS.FileInput {
  constructor(
    original: StmtNS.FileInput,
    public readonly typeAnnotations: WeakMap<object, AbstractValue>,
  ) {
    super(original.startToken, original.endToken, original.statements, original.varDecls);
  }
}

/**
 * Join multiple FunctionProfiles into one by OR-ing AbstractValues for each slot.
 */
function joinProfiles(profiles: FunctionProfile[]): Map<number, AbstractValue> {
  const result = new Map<number, AbstractValue>();
  for (const profile of profiles) {
    for (const [slot, value] of profile) {
      const existing = result.get(slot);
      result.set(slot, existing === undefined ? value : join(existing, value));
    }
  }
  return result;
}

/**
 * Produce an EnrichedFileInput by running abstract interpretation over each
 * profiled function using the observed argument type profiles.
 *
 * @param ast - The original parsed FileInput (shared object — not mutated).
 * @param typeInfo - Profiling output from Backend.collectTypeInfo().
 * @param slotLookupFactory - Factory that builds a SlotLookup for a given
 *   function node. Pass `(fn) => compiler.createSlotLookupForFunction(fn)`
 *   where compiler is the SVMLCompiler that compiled ast.
 */
export function specialize(
  ast: StmtNS.FileInput,
  typeInfo: TypeInformation,
  slotLookupFactory: (funcNode: SpecializableFunctionNode) => SlotLookup,
): EnrichedFileInput {
  const merged: WeakMap<object, AbstractValue> = new WeakMap();
  const lambdaBodyCache = new WeakMap<ExprNS.Lambda, StmtNS.Stmt[]>();

  for (const [funcNode, profiles] of typeInfo) {
    if (profiles.length === 0) continue;

    const joined: TypeEnv = joinProfiles(profiles);

    // Resolve the function body — Lambda wraps its body in a Return statement.
    // Use a module-level WeakMap to cache the wrapper (avoids mutating AST nodes).
    let body: StmtNS.Stmt[];
    if (funcNode instanceof ExprNS.Lambda) {
      let wrapper = lambdaBodyCache.get(funcNode);
      if (!wrapper) {
        wrapper = [new StmtNS.Return(funcNode.startToken, funcNode.endToken, funcNode.body)];
        lambdaBodyCache.set(funcNode, wrapper);
      }
      body = wrapper;
    } else {
      // FunctionDef and MultiLambda both have a `.body: Stmt[]` field.
      body = funcNode.body;
    }

    const slotLookup = slotLookupFactory(funcNode);
    const result = specializeAST(body, joined, slotLookup);

    // Merge expression annotations into the shared WeakMap.
    // Since WeakMap has no iteration, re-walk the body to copy from result.exprTypes.
    copyExprTypes(body, result.exprTypes, merged);
  }

  return new EnrichedFileInput(ast, merged);
}

/**
 * Walk all AST nodes in body and copy annotated entries from src into dst.
 * Uses traverseAST so any new node types are automatically covered.
 */
function copyExprTypes(
  stmts: StmtNS.Stmt[],
  src: WeakMap<object, AbstractValue>,
  dst: WeakMap<object, AbstractValue>,
): void {
  for (const stmt of stmts) {
    traverseAST(stmt, node => {
      const v = src.get(node);
      if (v !== undefined) dst.set(node, v);
    });
  }
}
