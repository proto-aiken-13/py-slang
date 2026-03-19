import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";

// Build-time backend selection via environment variables
const BACKEND = process.env.BACKEND || 'svml';
const JIT = process.env.JIT !== 'off'; // default on

const replacePlugin = replace({
  preventAssignment: true,
  values: {
    '__BACKEND__': JSON.stringify(BACKEND),
    '__JIT__': JSON.stringify(JIT),
  },
});

/**
 * @type {import('rollup').RollupOptions}
 */
const config = [{
  input: 'src/index.ts',
  output: {
    file: 'dist/worker.js',
    format: 'iife',
    name: 'PySlangWorker'
  },
  plugins: [
    replacePlugin,
    commonjs(), json(), typescript(), nodeResolve(), nodePolyfills(),
    terser({
      compress: {
        global_defs: {
          __DEBUG__: false
        },
        drop_console: true,
        dead_code: true,
        passes: 5,
        ecma: 5, // Set appropriate ECMAScript version for compatibility
      }
    })
  ]
},
{
  input: 'src/conductor/PyEvaluator.ts',
  output: {
    file: 'dist/python-evaluator.cjs',
    format: 'cjs',
    name: 'PySlangEvaluator'
  },
  plugins: [
    replacePlugin,
    commonjs(), json(), typescript(), nodeResolve(), nodePolyfills(),
    terser({
      // Disable all default compressions
      compress: {
        global_defs: {
          __DEBUG__: false
        },
        drop_console: true,
        defaults: false,
        unused: true, // Eliminate unused code
        dead_code: true, // Remove unreachable code
      },
      // Disable mangling (renaming variables)
      mangle: false,
      // Format output to be readable
      format: {
        beautify: true,
      },
    })
  ]
}];

export default config;
