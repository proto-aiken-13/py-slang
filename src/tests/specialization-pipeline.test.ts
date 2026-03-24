import { parse } from "../parser/parser-adapter";
import { SVMLBackend } from "../vm/svml-backend";
import { SVMLCompiler } from "../vm/svml-compiler";
import { StmtNS, ExprNS } from "../ast-types";
import { EnrichedFileInput, specialize } from "../specialization/enrich";
import { INT_BIT } from "../types/abstract-value";
import { WasmBackend } from "../wasm-compiler/wasm-backend";

describe("SVMLBackend.collectTypeInfo", () => {
  async function runAndCollect(code: string) {
    const src = code.endsWith("\n") ? code : code + "\n";
    const ast = parse(src);
    const backend = new SVMLBackend({ jit: true });
    await backend.run(ast, new Map());
    return { ast, backend, typeInfo: backend.collectTypeInfo() };
  }

  test("returns empty map before any run", () => {
    const backend = new SVMLBackend({ jit: true });
    expect(backend.collectTypeInfo()).toEqual(new Map());
  });

  test("returns empty map when no functions are called", async () => {
    const { typeInfo } = await runAndCollect("x = 1 + 2");
    expect(typeInfo.size).toBe(0);
  });

  test("collects profile for a called function", async () => {
    const { typeInfo } = await runAndCollect("def f(x, y):\n  return x + y\nf(3, 4)");
    expect(typeInfo.size).toBe(1);
    const [, profiles] = [...typeInfo.entries()][0];
    expect(profiles.length).toBeGreaterThan(0);
    // param 0 = positive integer (3), param 1 = positive integer (4)
    expect(profiles[0].has(0)).toBe(true);
    expect(profiles[0].has(1)).toBe(true);
  });

  test("each distinct signature produces a separate profile", async () => {
    // Call f with two different argument types (Pos vs Neg) → two JIT misses → two profiles
    const { typeInfo } = await runAndCollect("def f(x):\n  return x\nf(1)\nf(-1)");
    expect(typeInfo.size).toBe(1);
    const [, profiles] = [...typeInfo.entries()][0];
    expect(profiles.length).toBe(2);
  });

  test("no-JIT backend returns empty results for collectTypeInfo", async () => {
    const src = "def f(x):\n  return x\nf(1)\n";
    const ast = parse(src);
    const backend = new SVMLBackend({ jit: false });
    await backend.run(ast, new Map());
    // no-JIT backend: compiler is absent so getSpecializedIR returns early before
    // recording observations, resulting in an empty typeInfo map.
    const typeInfo = backend.collectTypeInfo();
    expect(typeInfo.size).toBe(0);
  });
});

describe("specialize()", () => {
  async function buildEnriched(code: string) {
    const src = code.endsWith("\n") ? code : code + "\n";
    const ast = parse(src);
    const backend = new SVMLBackend({ jit: true });
    await backend.run(ast, new Map());
    const typeInfo = backend.collectTypeInfo();

    // Build a compiler from the same AST to get a SlotLookup factory.
    const compiler = SVMLCompiler.fromProgram(ast);
    compiler.compileProgram(ast);
    const factory = (fn: StmtNS.FunctionDef | ExprNS.Lambda | ExprNS.MultiLambda) =>
      compiler.createSlotLookupForFunction(fn);

    return specialize(ast, typeInfo, factory);
  }

  test("returns an EnrichedFileInput", async () => {
    const enriched = await buildEnriched("def f(x):\n  return x + 1\nf(5)");
    expect(enriched).toBeInstanceOf(EnrichedFileInput);
  });

  test("typeAnnotations is defined when no profiling happened", async () => {
    const src = "x = 1 + 2\n";
    const ast = parse(src);
    const backend = new SVMLBackend({ jit: true });
    await backend.run(ast, new Map());
    const typeInfo = backend.collectTypeInfo();
    const compiler = SVMLCompiler.fromProgram(ast);
    compiler.compileProgram(ast);
    const enriched = specialize(ast, typeInfo, fn => compiler.createSlotLookupForFunction(fn));
    // No functions called → annotations WeakMap exists but is effectively empty.
    expect(enriched.typeAnnotations).toBeDefined();
  });

  test("annotates binary expression node for integer arguments", async () => {
    const src = "def f(x, y):\n  return x + y\nf(3, 4)\n";
    const ast = parse(src);
    const backend = new SVMLBackend({ jit: true });
    await backend.run(ast, new Map());
    const typeInfo = backend.collectTypeInfo();

    const compiler = SVMLCompiler.fromProgram(ast);
    compiler.compileProgram(ast);
    const enriched = specialize(ast, typeInfo, fn => compiler.createSlotLookupForFunction(fn));

    // Walk ast to find the `x + y` Binary node.
    const funcDef = ast.statements.find(s => s instanceof StmtNS.FunctionDef) as StmtNS.FunctionDef;
    const returnStmt = funcDef.body[0] as StmtNS.Return;
    const binaryExpr = returnStmt.value!; // x + y

    const annotation = enriched.typeAnnotations.get(binaryExpr);
    expect(annotation).toBeDefined();
    // Both operands are positive ints → result should have INT_BIT set.
    expect(annotation!.sound.kinds & INT_BIT).toBeTruthy();
  });
});

describe("WasmBackend with EnrichedFileInput", () => {
  async function runEnrichedWasm(code: string): Promise<number | boolean | null> {
    const src = code.endsWith("\n") ? code : code + "\n";
    const ast = parse(src);

    // Profile with SVML-JIT.
    const svml = new SVMLBackend({ jit: true });
    await svml.run(ast, new Map());
    const typeInfo = svml.collectTypeInfo();

    // Build enriched AST.
    const compiler = SVMLCompiler.fromProgram(ast);
    compiler.compileProgram(ast);
    const enriched = specialize(ast, typeInfo, fn => compiler.createSlotLookupForFunction(fn));

    // Run wasm on enriched AST.
    const result = await new WasmBackend().run(enriched, new Map());
    if (result.stderr) throw new Error(`wasm stderr: ${result.stderr}`);
    const v = result.value;
    switch (v.tag) {
      case "int":
        return v.value;
      case "bool":
        return v.value;
      case "none":
        return null;
      default:
        throw new Error(`unhandled tag: ${v.tag}`);
    }
  }

  test("integer addition fast path produces correct result", async () => {
    expect(await runEnrichedWasm("def f(x,y):\n  return x + y\nf(3,4)")).toBe(7);
  });

  test("integer subtraction fast path produces correct result", async () => {
    expect(await runEnrichedWasm("def f(x,y):\n  return x - y\nf(10,3)")).toBe(7);
  });

  test("integer multiplication fast path produces correct result", async () => {
    expect(await runEnrichedWasm("def f(x,y):\n  return x * y\nf(3,4)")).toBe(12);
  });

  test("integer division fast path produces correct result", async () => {
    expect(await runEnrichedWasm("def f(x,y):\n  return x / y\nf(6,2)")).toBe(3);
  });

  test("negative integer multiplication fast path produces correct result", async () => {
    expect(await runEnrichedWasm("def f(x,y):\n  return x * y\nf(3,-4)")).toBe(-12);
  });
});
