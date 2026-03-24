/**
 * Regression test for the copyExprTypes traversal in enrich.ts.
 *
 * These tests verify that specialize() correctly populates typeAnnotations
 * in the returned EnrichedFileInput. They act as a safety net for the
 * refactor that replaces copyStmt/copyExpr with traverseAST.
 */
import { parse } from "../parser/parser-adapter";
import { SVMLBackend } from "../backends/svml/svml-backend";
import { SVMLCompiler } from "../backends/svml/svml-compiler";
import { StmtNS, ExprNS } from "../ast-types";
import { EnrichedFileInput, specialize } from "../specialization/enrich";
import { INT_BIT } from "../types/abstract-value";

async function buildEnriched(
  code: string,
): Promise<{ ast: StmtNS.FileInput; enriched: EnrichedFileInput }> {
  const src = code.endsWith("\n") ? code : code + "\n";
  const ast = parse(src);
  const backend = new SVMLBackend({ jit: true });
  await backend.run(ast, new Map());
  const typeInfo = backend.collectTypeInfo();

  const compiler = SVMLCompiler.fromProgram(ast);
  compiler.compileProgram(ast);
  const factory = (fn: StmtNS.FunctionDef | ExprNS.Lambda | ExprNS.MultiLambda) =>
    compiler.createSlotLookupForFunction(fn);

  const enriched = specialize(ast, typeInfo, factory);
  return { ast, enriched };
}

describe("enrich.ts copyExprTypes traversal", () => {
  test("typeAnnotations WeakMap is populated for a called function", async () => {
    const { enriched } = await buildEnriched("def f(x):\n  return x + 1\nf(5)");
    expect(enriched).toBeInstanceOf(EnrichedFileInput);
    expect(enriched.typeAnnotations).toBeDefined();
  });

  test("annotates the binary node in: def f(x): return x + 1", async () => {
    const { ast, enriched } = await buildEnriched("def f(x):\n  return x + 1\nf(5)");

    const funcDef = ast.statements.find(s => s instanceof StmtNS.FunctionDef) as StmtNS.FunctionDef;
    const returnStmt = funcDef.body[0] as StmtNS.Return;
    const binaryExpr = returnStmt.value!; // x + 1

    const annotation = enriched.typeAnnotations.get(binaryExpr);
    expect(annotation).toBeDefined();
    expect(annotation!.sound.kinds & INT_BIT).toBeTruthy();
  });

  test("annotates nested binary expressions (x + y * 2)", async () => {
    const src = "def f(x, y):\n  return x + y * 2\nf(3, 4)\n";
    const { ast, enriched } = await buildEnriched(src);

    const funcDef = ast.statements.find(s => s instanceof StmtNS.FunctionDef) as StmtNS.FunctionDef;
    const returnStmt = funcDef.body[0] as StmtNS.Return;
    const outerBinary = returnStmt.value!; // x + (y * 2)

    // The outer binary (x + ...) should be annotated.
    const outerAnnotation = enriched.typeAnnotations.get(outerBinary);
    expect(outerAnnotation).toBeDefined();
    expect(outerAnnotation!.sound.kinds & INT_BIT).toBeTruthy();

    // The inner binary (y * 2) should also be annotated — tests that recursion works.
    const innerBinary = (outerBinary as ExprNS.Binary).right;
    const innerAnnotation = enriched.typeAnnotations.get(innerBinary);
    expect(innerAnnotation).toBeDefined();
    expect(innerAnnotation!.sound.kinds & INT_BIT).toBeTruthy();
  });

  test("typeAnnotations has entries (WeakMap is non-trivially populated)", async () => {
    // We cannot iterate a WeakMap, but we can verify a known node is present.
    const src = "def f(x, y):\n  return x + y\nf(3, 4)\n";
    const { ast, enriched } = await buildEnriched(src);

    const funcDef = ast.statements.find(s => s instanceof StmtNS.FunctionDef) as StmtNS.FunctionDef;
    const returnStmt = funcDef.body[0] as StmtNS.Return;
    const binaryExpr = returnStmt.value!;

    expect(enriched.typeAnnotations.has(binaryExpr)).toBe(true);
  });
});
