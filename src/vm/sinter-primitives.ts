import type { SVMLBoxType } from "./types";
import { isSVMLObject } from "./types";

// Minimal vm prelude for py-slang SVML compiler
export const vmPrelude = ''

// Map primitive function name to runtime opcodes
export const PRIMITIVE_FUNCTIONS: Map<string, number> = new Map([
  ["print", 5],
  ["display", 5], // Alias for print
  ["abs", 10],
  ["min", 20],
  ["max", 21],
  ["pow", 22],
  ["sqrt", 23],
  ["floor", 24],
  ["ceil", 25],
  ["round", 26],
  ["range", 30],
  ["len", 31],
])

/**
 * Execute a primitive function
 * This is called by the TypeScript interpreter for primitive operations
 */
export function executePrimitive(primitiveIndex: number, args: SVMLBoxType[], sendOutput: (message: string) => void): SVMLBoxType {
  // Math primitives receive numeric args at runtime; cast at the boundary
  const numArgs = args as number[];
  switch (primitiveIndex) {
    case 5: // print/display
      sendOutput(args.join(" "));
      return undefined;

    case 10: // abs
      if (args.length !== 1) throw new Error("abs expects 1 argument");
      return Math.abs(numArgs[0]);

    case 20: // min
      if (args.length === 0) throw new Error("min expects at least 1 argument");
      return Math.min(...numArgs);

    case 21: // max
      if (args.length === 0) throw new Error("max expects at least 1 argument");
      return Math.max(...numArgs);

    case 22: // pow
      if (args.length !== 2) throw new Error("pow expects 2 arguments");
      return Math.pow(numArgs[0], numArgs[1]);

    case 23: // sqrt
      if (args.length !== 1) throw new Error("sqrt expects 1 argument");
      return Math.sqrt(numArgs[0]);

    case 24: // floor
      if (args.length !== 1) throw new Error("floor expects 1 argument");
      return Math.floor(numArgs[0]);

    case 25: // ceil
      if (args.length !== 1) throw new Error("ceil expects 1 argument");
      return Math.ceil(numArgs[0]);

    case 26: // round
      if (args.length !== 1) throw new Error("round expects 1 argument");
      return Math.round(numArgs[0]);

    case 30: { // range
      const [a, b, c] = numArgs;
      const [start, stop, step] =
        args.length === 1 ? [0, a, 1] :
        args.length === 2 ? [a, b, 1] :
                            [a, b, c];
      return { type: "iterator", kind: "range", current: start, stop, step };
    }

    case 31: { // len
      const v = args[0];
      if (isSVMLObject(v) && v.type === "array") return v.elements.length;
      throw new Error("len() requires a list");
    }

    default:
      throw new Error(`Unknown primitive function index: ${primitiveIndex}`);
  }
}

// export from sinter = [ "accumulate",
// sivmfn_prim_append,
// sivmfn_prim_array_length,
// sivmfn_prim_build_list,
// sivmfn_prim_build_stream,
// sivmfn_prim_display,
// /* draw_data */ sivmfn_prim_noop, // not supported, obviously
// sivmfn_prim_enum_list,
// sivmfn_prim_enum_stream,
// sivmfn_prim_equal,
// sivmfn_prim_error,
// sivmfn_prim_eval_stream,
// sivmfn_prim_filter,
// sivmfn_prim_for_each,
// sivmfn_prim_head,
// sivmfn_prim_integers_from,
// sivmfn_prim_is_array,
// sivmfn_prim_is_boolean,
// sivmfn_prim_is_function,
// sivmfn_prim_is_list,
// sivmfn_prim_is_null,
// sivmfn_prim_is_number,
// sivmfn_prim_is_pair,
// sivmfn_prim_is_stream,
// sivmfn_prim_is_string,
// sivmfn_prim_is_undefined,
// sivmfn_prim_length,
// sivmfn_prim_list,
// sivmfn_prim_list_ref,
// sivmfn_prim_list_to_stream,
// /* list_to_string */ sivmfn_prim_unimpl, // do we want to implement this?
// sivmfn_prim_map,
// sivmfn_prim_math_abs,
// sivmfn_prim_math_acos,
// sivmfn_prim_math_acosh,
// sivmfn_prim_math_asin,
// sivmfn_prim_math_asinh,
// sivmfn_prim_math_atan,
// sivmfn_prim_math_atan2,
// sivmfn_prim_math_atanh,
// sivmfn_prim_math_cbrt,
// sivmfn_prim_math_ceil,
// sivmfn_prim_math_clz32,
// sivmfn_prim_math_cos,
// sivmfn_prim_math_cosh,
// sivmfn_prim_math_exp,
// sivmfn_prim_math_expm1,
// sivmfn_prim_math_floor,
// sivmfn_prim_math_fround,
// sivmfn_prim_math_hypot,
// sivmfn_prim_math_imul,
// sivmfn_prim_math_log,
// sivmfn_prim_math_log1p,
// sivmfn_prim_math_log2,
// sivmfn_prim_math_log10,
// sivmfn_prim_math_max,
// sivmfn_prim_math_min,
// sivmfn_prim_math_pow,
// sivmfn_prim_math_random,
// sivmfn_prim_math_round,
// sivmfn_prim_math_sign,
// sivmfn_prim_math_sin,
// sivmfn_prim_math_sinh,
// sivmfn_prim_math_sqrt,
// sivmfn_prim_math_tan,
// sivmfn_prim_math_tanh,
// sivmfn_prim_math_trunc,
// sivmfn_prim_member,
// sivmfn_prim_pair,
// /* parse_int */ sivmfn_prim_unimpl, // TODO: doesn't make sense without the ability to take input (prompt)
// sivmfn_prim_remove,
// sivmfn_prim_remove_all,
// sivmfn_prim_reverse,
// /* runtime */ sivmfn_prim_unimpl, // TODO: need to get time from host
// sivmfn_prim_set_head,
// sivmfn_prim_set_tail,
// sivmfn_prim_stream,
// sivmfn_prim_stream_append,
// sivmfn_prim_stream_filter,
// sivmfn_prim_stream_for_each,
// sivmfn_prim_stream_length,
// sivmfn_prim_stream_map,
// sivmfn_prim_stream_member,
// sivmfn_prim_stream_ref,
// sivmfn_prim_stream_remove,
// sivmfn_prim_stream_remove_all,
// sivmfn_prim_stream_reverse,
// sivmfn_prim_stream_tail,
// sivmfn_prim_stream_to_list,
// sivmfn_prim_tail
// ]