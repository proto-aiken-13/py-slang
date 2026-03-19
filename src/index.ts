import { initialise } from "@sourceacademy/conductor/runner";
import PyEvaluator from "./conductor/PyEvaluator";

const {runnerPlugin, conduit} = initialise(PyEvaluator);

export type { Backend } from "./backend/backend";
export { createBackend } from "./backend/config";
export type { BackendConfig } from "./backend/config";
