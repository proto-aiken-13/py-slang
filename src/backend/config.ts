import type { Backend } from "./backend";
import { SVMLBackend } from "../vm/svml-backend";
import { CSEBackend } from "../cse-machine/cse-backend";
import { WasmBackend } from "../wasm-compiler/wasm-backend";
import { WasmJITBackend } from "../wasm-compiler/wasm-jit-backend";

export type BackendType = "svml" | "cse" | "wasm" | "wasm-jit";

export interface BackendConfig {
  backend?: BackendType;
  jit?: boolean;
}

export function createBackend(config?: BackendConfig): Backend {
  const backendType = config?.backend ?? "svml";
  const jit = config?.jit ?? true;

  switch (backendType) {
    case "svml":
      return new SVMLBackend({ jit });
    case "cse":
      return new CSEBackend();
    case "wasm":
      return new WasmBackend();
    case "wasm-jit":
      return new WasmJITBackend();
    default:
      throw new Error(`Unknown backend: ${backendType}`);
  }
}
