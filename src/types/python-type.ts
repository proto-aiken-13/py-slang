export type PythonType =
  | { tag: "int"; value: number }
  | { tag: "bool"; value: boolean }
  | { tag: "str"; value: string }
  | { tag: "none" }
  | { tag: "list"; elements: PythonType[] }
  | { tag: "function"; name: string; arity: number };
