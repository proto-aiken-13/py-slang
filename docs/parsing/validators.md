# Writing Validators

Validators enforce sublanguage restrictions by inspecting AST nodes during the resolver pass. Each validator implements the `FeatureValidator` interface:

```typescript
interface FeatureValidator {
    validate(node: ASTNode, env?: Environment): void;
}
```

The resolver calls `validate()` on every AST node it visits. If a node violates the rule, the validator throws. If the node is irrelevant, it returns silently.

## Stateless validator (simple node-type check)

Most validators just check `instanceof` and throw. These are singletons — one object, reused across files.

```typescript
// src/validator/features/no-loops.ts
import { StmtNS } from "../../ast-types";
import { ASTNode, FeatureValidator, FeatureNotSupportedError } from "../types";

export const NoLoopsValidator: FeatureValidator = {
    validate(node: ASTNode): void {
        if (node instanceof StmtNS.While) {
            throw new FeatureNotSupportedError("while loops", node);
        }
        if (node instanceof StmtNS.For) {
            throw new FeatureNotSupportedError("for loops", node);
        }
    },
};
```

`FeatureNotSupportedError` extracts line/col from the node's `startToken` automatically.

## Stateful validator (scope-aware)

Some validators need to track state across nodes — e.g., "has this name been assigned before in this scope?" These use a factory function that returns a fresh validator instance with its own state. The `env` parameter gives access to the current scope.

```typescript
// src/validator/features/no-reassignment.ts
import { ExprNS, StmtNS } from "../../ast-types";
import { ASTNode, FeatureValidator } from "../types";
import { Environment } from "../../resolver/resolver";
import { ResolverErrors } from "../../resolver/errors";

export function createNoReassignmentValidator(): FeatureValidator {
    const declaredPerScope = new WeakMap<Environment, Set<string>>();
    return {
        validate(node: ASTNode, env?: Environment): void {
            if (!env) return;
            if (!(node instanceof StmtNS.Assign)) return;

            // ... check if name already declared in this scope, throw if so
            // ... add name to declared set
        },
    };
}
```

Use a factory (`createNoReassignmentValidator()`) instead of a singleton so each `analyze()` call gets fresh state.

## Composing validators into a chapter

Chapters are defined in `src/validator/sublanguages.ts`. Each chapter returns an array of validators:

```typescript
// src/validator/sublanguages.ts
import { FeatureValidator } from "./types";
import { NoListsValidator } from "./features/no-lists";
import { NoLoopsValidator } from "./features/no-loops";
import { createNoReassignmentValidator } from "./features/no-reassignment";
import { NoBreakContinueValidator } from "./features/no-break-continue";
import { NoNonlocalValidator } from "./features/no-nonlocal";
import { ForRangeOnlyValidator } from "./features/for-range-only";
import { NoRestParamsValidator } from "./features/no-rest-params";

/**
 * Source Chapter 1: no lists, no loops, no reassignment, no break/continue, no nonlocal, no rest params.
 * Factory function returns a fresh set of validators (stateful ones reset each time).
 */
export function makeChapter1Validators(): FeatureValidator[] {
    return [
        NoListsValidator,
        NoLoopsValidator,
        createNoReassignmentValidator(), // factory — fresh state per call
        NoBreakContinueValidator,
        NoNonlocalValidator,
        NoRestParamsValidator,
    ];
}

/**
 * Source Chapter 2: no lists, no loops, no reassignment, no break/continue, no nonlocal, no rest params.
 * Linked-list library available (None as linked list expression).
 */
export function makeChapter2Validators(): FeatureValidator[] {
    return [
        NoListsValidator,
        NoLoopsValidator,
        createNoReassignmentValidator(),
        NoBreakContinueValidator,
        NoNonlocalValidator,
        NoRestParamsValidator,
    ];
}

/**
 * Source Chapter 3: lists, loops, and reassignment are all allowed.
 * for loops are restricted to range() only.
 */
export function makeChapter3Validators(): FeatureValidator[] {
    return [ForRangeOnlyValidator];
}

/**
 * Source Chapter 4: unrestricted. No validators.
 */
export function makeChapter4Validators(): FeatureValidator[] {
    return [];
}

export function makeValidatorsForChapter(chapter: number): FeatureValidator[] {
    switch (chapter) {
        case 1: return makeChapter1Validators();
        case 2: return makeChapter2Validators();
        case 3: return makeChapter3Validators();
        case 4: return makeChapter4Validators();
        default: return makeChapter4Validators();
    }
}
```

The entry point `analyze(ast, source, chapter)` in `src/resolver/analysis.ts` wires it all together:

```typescript
export function analyze(ast: StmtNS.FileInput, source: string, chapter: number = 4): void {
    new Resolver(source, ast, makeValidatorsForChapter(chapter)).resolve(ast);
}
```

## Adding a new validator end-to-end

Example: ban global statements in Chapter 1.

**1. Create the validator:**

```typescript
// src/validator/features/no-global.ts
import { StmtNS } from "../../ast-types";
import { ASTNode, FeatureValidator, FeatureNotSupportedError } from "../types";

export const NoGlobalValidator: FeatureValidator = {
    validate(node: ASTNode): void {
        if (node instanceof StmtNS.Global) {
            throw new FeatureNotSupportedError("global statements", node);
        }
    },
};
```

**2. Add to chapter in sublanguages.ts:**

```typescript
import { NoGlobalValidator } from "./features/no-global";

export function makeChapter1Validators(): FeatureValidator[] {
    return [
        NoListsValidator,
        NoLoopsValidator,
        createNoReassignmentValidator(),
        NoLambdaValidator,
        NoBreakContinueValidator,
        NoGlobalValidator, // ← added
    ];
}
```

**3. Add test in analysis.test.ts:**

```typescript
test("global statement is banned in chapter 1", () => {
    expect(() => analyzeOk("def f():\n    global x", 1)).toThrow(FeatureNotSupportedError);
});
```

## Rules of thumb

- **Stateless** (just checking node types) → singleton object, no factory
- **Stateful** (tracking names, counts, scope) → factory function, use `env` parameter
- Validators should be fast — they run on every node in the AST
- Each validator is a single file in `src/validator/features/`
- Throw `FeatureNotSupportedError` for feature gates, `ResolverErrors.*` for semantic errors

