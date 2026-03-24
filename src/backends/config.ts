import type { Backend } from "./types";
import { SVMLBackend } from "./svml/svml-backend";
import { CSEBackend } from "./cse/cse-backend";
import { WasmBackend } from "./wasm/wasm-backend";
import { WasmJITBackend } from "./wasm/wasm-jit-backend";
import { SinterBackend } from "./svml/sinter-backend";

export type BackendType = "svml" | "cse" | "wasm" | "wasm-jit" | "sinter";

export interface BackendConfig {
  backend?: BackendType;
  jit?: boolean;
}

/**
 * Create a Backend instance.
 *
 * @param config.backend - "svml" (default) or "cse"
 * @param config.jit - Enable JIT specialization (default: true, SVML only)
 */
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
    case "sinter":
      return new SinterBackend();
    default:
      throw new Error(`Unknown backend: ${backendType}`);
  }
}
