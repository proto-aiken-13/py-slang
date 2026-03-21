import { ExprNS, StmtNS } from "../ast-types";
import { Closure } from "./closure";
import { Context } from "./context";
import { Heap } from "./heap";
import { Value } from "./stash";

export interface Frame {
  [name: string]: Value;
}

export interface Environment {
  readonly id: string;
  name: string;
  tail: Environment | null;
  callExpression?: ExprNS.Call;
  head: Frame;
  heap: Heap;
  thisContext?: Value;
  closure?: Closure;
}

export const uniqueId = (context: Context): string => {
  return `${context.runtime.objectCount++}`;
};

export const createEnvironment = (
  context: Context,
  closure: Closure,
  args: Value[],
  callExpression: ExprNS.Call,
): Environment => {
  const environment: Environment = {
    name:
      ((closure.node as any).kind ?? closure.node.constructor.name) === "FunctionDef"
        ? (closure.node as StmtNS.FunctionDef).name.lexeme
        : "lambda",
    tail: closure.environment,
    head: {},
    heap: new Heap(),
    id: uniqueId(context),
    callExpression: callExpression,
    closure: closure,
  };

  // console.info('closure.node.params:', closure.node.params);
  // console.info('Number of params:', closure.node.params.length);

  closure.node.parameters.forEach((paramToken, index) => {
    const paramName = paramToken.lexeme;
    environment.head[paramName] = args[index];
  });
  return environment;
};

export const createSimpleEnvironment = (
  context: Context,
  name: string,
  tail: Environment | null = null,
): Environment => {
  return {
    id: uniqueId(context),
    name,
    tail,
    head: {},
    heap: new Heap(),
    // TODO: callExpression and thisContext are optional and can be provided as needed.
  };
};

export const createProgramEnvironment = (context: Context, isPrelude: boolean): Environment => {
  return createSimpleEnvironment(context, isPrelude ? "prelude" : "programEnvironment");
};

// export const handleArrayCreation = (
//   context: Context,
//   array: Value[],
//   envOverride?: Environment
// ): void => {
//   const environment = envOverride ?? currentEnvironment(context)
//   Object.defineProperties(array, {
//     id: { value: uniqueId(context) },
//     environment: { value: environment, writable: true }
//   })
//   environment.heap.add(array)
// }

export const currentEnvironment = (context: Context): Environment => {
  const envs = context.runtime.environments;
  return envs[envs.length - 1];
};

export const getGlobalEnvironment = (context: Context): Environment | null => {
  const envs = context.runtime.environments;
  return envs.length > 0 ? envs[0] : null;
};

export const popEnvironment = (context: Context) => context.runtime.environments.pop();

export const pushEnvironment = (context: Context, environment: Environment) => {
  context.runtime.environments.push(environment);
  context.runtime.environmentTree.insert(environment);
};
