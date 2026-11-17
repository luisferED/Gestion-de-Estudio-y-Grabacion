import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Resolve the real cookie helpers for tests that load Worker code via data URLs.
const source=(await readFile(new URL('../lib/auth-cookies.ts',import.meta.url),'utf8'))
  .replace('import {APP_BASE_PATH,APP_COOKIE_PATH} from "./app-path";','const APP_BASE_PATH="",APP_COOKIE_PATH="/";');
export const authCookiesUrl='data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText).toString('base64');
