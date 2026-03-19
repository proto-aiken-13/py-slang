import { createBackend } from "../backend/config";
import { SVMLBackend } from "../vm/svml-backend";
import { WasmBackend } from "../wasm-compiler/wasm-backend";
import { WasmJITBackend } from "../wasm-compiler/wasm-jit-backend";

describe("createBackend", () => {
  test("svml backend with jit on", () => {
    const backend = createBackend({ backend: "svml", jit: true });
    expect(backend).toBeInstanceOf(SVMLBackend);
  });

  test("svml backend with jit off", () => {
    const backend = createBackend({ backend: "svml", jit: false });
    expect(backend).toBeInstanceOf(SVMLBackend);
  });

  test("defaults to svml with jit on", () => {
    const backend = createBackend();
    expect(backend).toBeInstanceOf(SVMLBackend);
  });

  test("cse backend throws not implemented", () => {
    expect(() => createBackend({ backend: "cse" })).toThrow("not implemented");
  });

  test("wasm backend returns WasmBackend instance", () => {
    const backend = createBackend({ backend: "wasm" });
    expect(backend).toBeInstanceOf(WasmBackend);
  });

  test("wasm-jit backend returns WasmJITBackend instance", () => {
    const backend = createBackend({ backend: "wasm-jit" });
    expect(backend).toBeInstanceOf(WasmJITBackend);
  });
});
