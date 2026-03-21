import type { SpecializableFunctionNode, FunctionProfile, TypeInformation } from "../specialization/types";

/**
 * Maps runtime IDs back to their registered AST nodes.
 *
 * Compilers call register() during codegen.
 * Backends call resolve() after execution to get TypeInformation.
 *
 * @template ID - The runtime identifier type: `number` for SVML function
 *   indices, `string` for Wasm export names or other string-keyed schemes.
 */
export class BackwardsBindings<ID extends number | string = number> {
  private readonly nodeById = new Map<ID, SpecializableFunctionNode>();

  /**
   * Record that `node` was assigned `id` during compilation.
   * Throws if `id` is already registered (compiler bug guard).
   */
  register(node: SpecializableFunctionNode, id: ID): void {
    if (this.nodeById.has(id)) {
      throw new Error(`BackwardsBindings: duplicate registration for id ${String(id)}`);
    }
    this.nodeById.set(id, node);
  }

  /**
   * Resolve runtime observations (ID -> profiles) into TypeInformation
   * (SpecializableFunctionNode -> profiles).
   *
   * Unknown IDs are silently dropped. Safe to call multiple times.
   */
  resolve(
    observations: ReadonlyMap<ID, FunctionProfile[]>,
  ): TypeInformation {
    const result = new Map<SpecializableFunctionNode, FunctionProfile[]>();
    for (const [id, rawProfiles] of observations) {
      const node = this.nodeById.get(id);
      if (!node) continue;
      // Snapshot each profile: callers must not mutate the returned TypeInformation.
      result.set(node, rawProfiles.map(p => new Map(p) as FunctionProfile));
    }
    return result;
  }

  /** Number of registered bindings. */
  get size(): number {
    return this.nodeById.size;
  }
}
