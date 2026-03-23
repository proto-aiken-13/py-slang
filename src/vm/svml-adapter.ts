import type { BackendAdapter } from "../backend/adapter";
import type { PythonType } from "../types/python-type";
import type { AbstractValue } from "../types/abstract-value";
import type { SVMLBoxType } from "./types";
import {
  positiveInteger,
  negativeInteger,
  zeroInteger,
  trueValue,
  falseValue,
  stringValue,
  closureValue,
  nullValue,
  TOP,
} from "../types/lattice-ops";

export class SVMLAdapter implements BackendAdapter<SVMLBoxType> {
  toPython(native: SVMLBoxType): PythonType {
    if (native === null || native === undefined) return { tag: "none" };
    switch (typeof native) {
      case "number":
        return { tag: "int", value: native };
      case "boolean":
        return { tag: "bool", value: native };
      case "string":
        return { tag: "str", value: native };
      default:
        if (typeof native === "object" && native !== null && "type" in native) {
          if (native.type === "closure") {
            return { tag: "function", name: "<closure>", arity: 0 };
          }
          if (native.type === "array") {
            return { tag: "list", elements: native.elements.map(e => this.toPython(e)) };
          }
        }
        return { tag: "none" };
    }
  }

  toAbstractValue(python: PythonType): AbstractValue {
    switch (python.tag) {
      case "int": {
        const v = python.value;
        if (v > 0) return positiveInteger();
        if (v < 0) return negativeInteger();
        return zeroInteger();
      }
      case "bool":
        return python.value ? trueValue() : falseValue();
      case "str":
        return stringValue();
      case "none":
        return nullValue();
      case "function":
        return closureValue();
      case "list":
        return TOP;
    }
  }
}
