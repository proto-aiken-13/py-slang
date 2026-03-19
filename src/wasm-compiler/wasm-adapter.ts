import type { BackendAdapter } from "../backend/adapter";
import type { PythonType } from "../types/python-type";
import type { AbstractValue } from "../types/abstract-value";
import { TYPE_TAG } from "./constants";
import {
  positiveInteger,
  negativeInteger,
  zeroInteger,
  trueValue,
  falseValue,
  stringValue,
  nullValue,
  TOP,
} from "../types/lattice-ops";

type WasmNative = { tag: number; payload: bigint; memory: WebAssembly.Memory };

export class WasmAdapter implements BackendAdapter<WasmNative> {
  toPython({ tag, payload, memory }: WasmNative): PythonType {
    switch (tag) {
      case TYPE_TAG.INT:
        return { tag: "int", value: Number(payload) };

      case TYPE_TAG.FLOAT: {
        // Reinterpret i64 bits as f64 (little-endian bit-cast — correct because
        // WebAssembly is always little-endian and the DataView roundtrip uses the
        // same endianness for both write and read).
        // Stored as { tag: "int" } since PythonType has no float variant.
        const buf = new ArrayBuffer(8);
        new DataView(buf).setBigInt64(0, payload, true);
        return { tag: "int", value: new DataView(buf).getFloat64(0, true) };
      }

      case TYPE_TAG.BOOL:
        return { tag: "bool", value: payload !== 0n };

      case TYPE_TAG.STRING: {
        const ptr = Number(payload >> 32n);
        const len = Number(payload & 0xffffffffn);
        return {
          tag: "str",
          value: new TextDecoder("utf-8").decode(
            new Uint8Array(memory.buffer, ptr, len),
          ),
        };
      }

      case TYPE_TAG.NONE:
      default:
        // Covers NONE(6), COMPLEX(2), CLOSURE(5), PAIR(8), UNBOUND(7),
        // and the no-return sentinel (-1) from compileFromAST.
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
        return TOP;
      case "list":
        return TOP;
    }
  }
}
