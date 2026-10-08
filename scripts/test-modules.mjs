import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// Each Node test worker compiles into its own directory to avoid file races.
const output = new URL(`../.artifacts/test-modules/${process.pid}/`, import.meta.url);
await mkdir(output, { recursive: true });
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (!/\.tsx?$/.test(name)) continue;
  const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replaceAll(/from '\.\/([^']+)'/g, "from './$1.mjs'");
  await writeFile(new URL(name.replace(/\.tsx?$/, '.mjs'), output), compiled);
}
export const importModule = name => import(new URL(`${name}.mjs`, output));
