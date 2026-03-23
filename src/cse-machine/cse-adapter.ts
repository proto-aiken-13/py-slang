import type { PythonType } from "../types/python-type";
import type { Value } from "./stash";

export class CSEAdapter {
  toPython(value: Value): PythonType {
    switch (value.type) {
      case "number":
      case "int":
        return { tag: "int", value: value.value };
      case "float":
        // PythonType has no "float" tag yet; map to "int" (both are JS numbers)
        return { tag: "int", value: value.value };
      case "bool":
        return { tag: "bool", value: value.value };
      case "string":
        return { tag: "str", value: value.value };
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
      case "bigint":
        // Lossy: BigInt → number truncation for values exceeding Number.MAX_SAFE_INTEGER
        return { tag: "int", value: Number(value.value) };
      case "error":
      case "complex":
      default:
        return { tag: "none" };
    }
  }
}
