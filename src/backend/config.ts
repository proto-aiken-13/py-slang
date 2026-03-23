import type { Backend } from "./backend";
import { SVMLBackend } from "../vm/svml-backend";
import { CSEBackend } from "../cse-machine/cse-backend";

export type BackendType = "svml" | "cse";

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
    default:
      throw new Error(`Unknown backend: ${backendType}`);
  }
}
