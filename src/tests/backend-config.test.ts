import { createBackend } from "../backends/config";
import { SVMLBackend } from "../backends/svml/svml-backend";
import { CSEBackend } from "../backends/cse/cse-backend";
import { WasmBackend } from "../backends/wasm/wasm-backend";
import { WasmJITBackend } from "../backends/wasm/wasm-jit-backend";

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

  test("cse backend returns CSEBackend instance", () => {
    const backend = createBackend({ backend: "cse" });
    expect(backend).toBeInstanceOf(CSEBackend);
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
