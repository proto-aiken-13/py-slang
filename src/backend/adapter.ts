import type { PythonType } from "../types/python-type";
import type { AbstractValue } from "../types/abstract-value";

export interface BackendAdapter<TNative> {
  toPython(native: TNative): PythonType;
  toAbstractValue(python: PythonType): AbstractValue;
}
