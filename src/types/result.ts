import type { PythonType } from "./python-type";

export interface ComputationalResult {
  value: PythonType;
  stdout: string;
  stderr: string;
  error?: RuntimeError;
}

export interface RuntimeError {
  kind:
    | "type_error"
    | "name_error"
    | "zero_division"
    | "index_error"
    | "value_error"
    | "recursion_limit"
    | "timeout";
  message: string;
  line?: number;
  column?: number;
}
