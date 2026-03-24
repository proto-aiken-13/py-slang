import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import commonjs from "@rollup/plugin-commonjs";
import nodePolyfills from "rollup-plugin-polyfill-node";
import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";
import wasm from "@rollup/plugin-wasm";

// Build-time backend selection via environment variables.
// Set by scripts/build.ts; defaults to SVML with JIT enabled.
const BACKEND = process.env.BACKEND || "svml";
const JIT = process.env.JIT !== "off";

const replacePlugin = replace({
  preventAssignment: true,
  values: {
    __BACKEND__: JSON.stringify(BACKEND),
    __JIT__: JSON.stringify(JIT),
  },
});

// Browser bundle: aggressively optimize for size, strip debug code
const terserBrowser = terser({
  compress: {
    global_defs: { __DEBUG__: false },
    drop_console: true,
    dead_code: true,
    passes: 5,
    ecma: 5,
  },
});

// Node.js evaluator: readable output for debugging, no mangling
const terserNode = terser({
  compress: {
    global_defs: { __DEBUG__: false },
    drop_console: true,
    defaults: false,
    unused: true,
    dead_code: true,
  },
  mangle: false,
  format: { beautify: true },
});

/**
 * Plugin order (preserved from working config):
 * 1. replace      — Inject __BACKEND__/__JIT__ before any compilation
 * 2. commonjs     — Convert CJS modules to ESM
 * 3. json         — Handle JSON imports
 * 4. typescript   — Transpile TS to JS
 * 5. nodeResolve  — Resolve node_modules
 * 6. nodePolyfills — Polyfill Node builtins for browser
 * 7. terser       — Minify (must be last)
 */
function plugins(terserConfig) {
  return [
    replacePlugin,
    commonjs(),
    json(),
    wasm({ maxFileSize: 100_000 }),
    typescript(),
    nodeResolve(),
    nodePolyfills(),
    terserConfig,
  ];
}

/**
 * @type {import('rollup').RollupOptions}
 */
const config = [
  {
    input: "src/index.ts",
    output: {
      file: "dist/worker.js",
      format: "iife",
      name: "PySlangWorker",
      sourcemap: true,
    },
    plugins: plugins(terserBrowser),
  },
  {
    input: "src/conductor/PyEvaluator.ts",
    output: {
      file: "dist/python-evaluator.cjs",
      format: "cjs",
      name: "PySlangEvaluator",
      sourcemap: true,
    },
    plugins: plugins(terserNode),
  },
];

export default config;
