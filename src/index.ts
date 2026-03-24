import { initialise } from "@sourceacademy/conductor/runner";
import PyEvaluator from "./conductor/PyEvaluator";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { runnerPlugin, conduit } = initialise(PyEvaluator);

// Public API — re-export for external consumers and IDE autocomplete.
export type { Backend } from "./backend/backend";
export { createBackend, BackendConfig } from "./backend/config";
export { specialize, EnrichedFileInput } from "./specialization/enrich";
