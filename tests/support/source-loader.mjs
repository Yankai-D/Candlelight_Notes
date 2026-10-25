import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = resolve(projectRoot, 'src') + sep;

// DOM integration uses real source modules without a development server.
// Vite compilation, styles and browser behavior are checked separately by
// the build and real-browser suites. No source behavior is mocked here.
export function createSourceLoader() {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith('file:') && specifier.startsWith('.') && !extname(specifier)) {
        const path = fileURLToPath(new URL(specifier, context.parentURL));
        if (path.startsWith(sourceRoot)) for (const extension of ['.ts', '.tsx']) {
          if (existsSync(path + extension)) return { url: pathToFileURL(path + extension).href, shortCircuit: true };
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith('file:')) {
        const path = fileURLToPath(url);
        if (path.startsWith(sourceRoot) && /\.tsx?$/.test(path)) return {
          format: 'module', shortCircuit: true,
          source: ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
            module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true,
          } }).outputText,
        };
        if (path.startsWith(sourceRoot) && path.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {}' };
      }
      return next(url, context);
    },
  });
  return {
    load(path) {
      const target = resolve(projectRoot, '.' + path);
      if (!target.startsWith(sourceRoot)) throw new Error('DOM test loader only accepts application source entrypoints');
      return import(pathToFileURL(target).href);
    },
    close: () => hooks.deregister(),
  };
}
