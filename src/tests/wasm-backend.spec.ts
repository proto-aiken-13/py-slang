import { parse } from "../parser/parser-adapter";
import { StmtNS } from "../ast-types";
import { compileFromAST, WasmConsoleImports } from "../backends/wasm";
import { TYPE_TAG } from "../backends/wasm/constants";
import { WasmAdapter } from "../backends/wasm/wasm-adapter";
import { WasmBackend } from "../backends/wasm/wasm-backend";
import type { FunctionEnvironments } from "../resolver";

const emptyEnvs: FunctionEnvironments = new Map();

const noopConsole: WasmConsoleImports = {
  log: () => {},
  log_bool: () => {},
  log_string: () => {},
  log_closure: () => {},
  log_none: () => {},
  log_complex: () => {},
  log_error: () => {},
  log_pair: () => {},
};

describe("compileFromAST", () => {
  it("compiles integer expression and returns correct tag+payload", async () => {
    const ast = parse("1 + 2\n");
    const memory = new WebAssembly.Memory({ initial: 1 });
    const { tag, payload } = await compileFromAST(ast, memory, noopConsole);
    expect(tag).toBe(TYPE_TAG.INT);
    expect(payload).toBe(3n);
  });

  it("returns tag=TYPE_TAG.NONE for statement-only program (print returns None)", async () => {
    // print() returns None — the wasm $main extracts the undropped SimpleExpr result,
    // which is the return value of print (None, tag=6). So tag=TYPE_TAG.NONE, not -1.
    // tag=-1 is only produced when $main truly has no return type (empty program).
    const captured: string[] = [];
    const ast = parse('print("hello")\n');
    const memory = new WebAssembly.Memory({ initial: 1 });
    const cons: WasmConsoleImports = {
      ...noopConsole,
      log_string: (offset: number, length: number) => {
        captured.push(
          new TextDecoder("utf-8").decode(new Uint8Array(memory.buffer, offset, length)),
        );
      },
    };
    const { tag } = await compileFromAST(ast, memory, cons);
    expect(tag).toBe(TYPE_TAG.NONE);
    expect(captured[0]).toBe("hello");
  });
});

describe("WasmAdapter.toPython", () => {
  const adapter = new WasmAdapter();

  it("decodes INT", () => {
    expect(
      adapter.toPython({
        tag: TYPE_TAG.INT,
        payload: 42n,
        memory: new WebAssembly.Memory({ initial: 1 }),
      }),
    ).toEqual({ tag: "int", value: 42 });
  });

  it("decodes negative INT", () => {
    expect(
      adapter.toPython({
        tag: TYPE_TAG.INT,
        payload: -1n,
        memory: new WebAssembly.Memory({ initial: 1 }),
      }),
    ).toEqual({ tag: "int", value: -1 });
  });

  it("decodes BOOL true", () => {
    expect(
      adapter.toPython({
        tag: TYPE_TAG.BOOL,
        payload: 1n,
        memory: new WebAssembly.Memory({ initial: 1 }),
      }),
    ).toEqual({ tag: "bool", value: true });
  });

  it("decodes BOOL false", () => {
    expect(
      adapter.toPython({
        tag: TYPE_TAG.BOOL,
        payload: 0n,
        memory: new WebAssembly.Memory({ initial: 1 }),
      }),
    ).toEqual({ tag: "bool", value: false });
  });

  it("decodes NONE", () => {
    expect(
      adapter.toPython({
        tag: TYPE_TAG.NONE,
        payload: 0n,
        memory: new WebAssembly.Memory({ initial: 1 }),
      }),
    ).toEqual({ tag: "none" });
  });

  it("decodes STRING from wasm memory", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const encoded = new TextEncoder().encode("hello");
    const ptr = 64;
    new Uint8Array(memory.buffer).set(encoded, ptr);
    const payload = (BigInt(ptr) << 32n) | BigInt(encoded.length);
    expect(adapter.toPython({ tag: TYPE_TAG.STRING, payload, memory })).toEqual({
      tag: "str",
      value: "hello",
    });
  });

  it("decodes unknown tag (-1 sentinel) as none", () => {
    expect(
      adapter.toPython({
        tag: -1,
        payload: 0n,
        memory: new WebAssembly.Memory({ initial: 1 }),
      }),
    ).toEqual({ tag: "none" });
  });
});

describe("WasmBackend.run", () => {
  const backend = new WasmBackend();

  it("returns integer value", async () => {
    const ast = parse("42\n");
    const result = await backend.run(ast, emptyEnvs);
    expect(result.value).toEqual({ tag: "int", value: 42 });
    expect(result.stderr).toBe("");
  });

  it("returns boolean value", async () => {
    const ast = parse("True\n");
    const result = await backend.run(ast, emptyEnvs);
    expect(result.value).toEqual({ tag: "bool", value: true });
  });

  it("returns none for statement-only program", async () => {
    const ast = parse("x = 1\n");
    const result = await backend.run(ast, emptyEnvs);
    expect(result.value).toEqual({ tag: "none" });
  });

  it("captures print() output in stdout", async () => {
    const ast = parse('print("hello")\n');
    const result = await backend.run(ast, emptyEnvs);
    expect(result.stdout).toBe("hello");
    expect(result.value).toEqual({ tag: "none" });
  });

  it("captures multiple print() calls separated by newline", async () => {
    const ast = parse('print("a")\nprint("b")\n');
    const result = await backend.run(ast, emptyEnvs);
    expect(result.stdout).toBe("a\nb");
  });

  it("populates stderr when wasm runtime error occurs", async () => {
    // Calling a non-function triggers log_error(CALL_NOT_FX) + wasm unreachable trap.
    // stderr will contain both the log_error message and the RuntimeError message.
    const ast = parse("x = 1\nx(2)\n");
    const result = await backend.run(ast, emptyEnvs);
    expect(result.stderr).not.toBe("");
    expect(result.value).toEqual({ tag: "none" });
  });
});
