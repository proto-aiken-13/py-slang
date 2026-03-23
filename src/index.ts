import { initialise } from "@sourceacademy/conductor/runner";
import PyEvaluator from "./conductor/PyEvaluator";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { runnerPlugin, conduit } = initialise(PyEvaluator);

export type { Backend } from "./backend/backend";
export { createBackend } from "./backend/config";
export type { BackendConfig } from "./backend/config";
