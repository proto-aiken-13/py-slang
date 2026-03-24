import type { PythonType } from "../types/python-type";
import type { Value } from "./stash";

export class CSEAdapter {
  toPython(value: Value): PythonType {
    switch (value.type) {
      case "int":
        return { tag: "int", value: value.value };
      case "number":
        // CSE "number" is ambiguous; use integer heuristic
        if (Number.isInteger(value.value) && Number.isFinite(value.value)) {
          return { tag: "int", value: value.value };
        }
        return { tag: "float", value: value.value };
      case "float":
        return { tag: "float", value: value.value };
      case "bool":
        return { tag: "bool", value: value.value };
      case "string":
        return { tag: "str", value: value.value };
      case "complex":
        return { tag: "complex", real: value.value.real, imag: value.value.imag };
      case "bigint":
        // Lossy: BigInt → number truncation for values exceeding Number.MAX_SAFE_INTEGER
        return { tag: "int", value: Number(value.value) };
      case "none":
      case "NoneType":
      case "undefined":
        return { tag: "none" };
      case "closure":
        return {
          tag: "function",
          name: "<closure>",
          arity: value.closure.node.parameters.length,
        };
      case "function":
        return { tag: "function", name: value.name, arity: value.params.length };
      case "multi_lambda":
        return { tag: "function", name: "<lambda>", arity: value.parameters.length };
      case "builtin":
        // BuiltinValue doesn't carry arity info in its interface
        return { tag: "function", name: value.name, arity: 0 };
      case "error":
      default:
        return { tag: "none" };
    }
  }
}
