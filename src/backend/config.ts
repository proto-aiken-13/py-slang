import type { Backend } from "./backend";
import { SVMLBackend } from "../vm/svml-backend";

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
      throw new Error("CSE machine backend not implemented yet");
    default:
      throw new Error(`Unknown backend: ${backendType}`);
  }
}
