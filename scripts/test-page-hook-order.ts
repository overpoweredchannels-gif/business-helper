import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const pagePath = path.join(process.cwd(), "src/app/page.tsx");
const source = readFileSync(pagePath, "utf8");
const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

let homeFunction: ts.FunctionDeclaration | undefined;
for (const statement of sourceFile.statements) {
  if (
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "Home" &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  ) {
    homeFunction = statement;
    break;
  }
}
assert.ok(homeFunction?.body, "the default Home page function must exist");

let loggedOutGuard: ts.IfStatement | undefined;
const findGuard = (node: ts.Node) => {
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(sourceFile).replace(/\s/g, "") === "!currentUser" &&
    node.thenStatement.getText(sourceFile).includes("return")
  ) {
    loggedOutGuard = node;
    return;
  }
  ts.forEachChild(node, findGuard);
};
findGuard(homeFunction.body);
assert.ok(loggedOutGuard, "Home must retain its logged-out early return");

const hooksAfterGuard: string[] = [];
const findHooksAfterGuard = (node: ts.Node) => {
  if (node.getStart(sourceFile) > loggedOutGuard!.getStart(sourceFile) && ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && /^use[A-Z]/.test(callee.text)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      hooksAfterGuard.push(`${callee.text} at line ${line + 1}`);
    }
  }
  ts.forEachChild(node, findHooksAfterGuard);
};
findHooksAfterGuard(homeFunction.body);

assert.deepEqual(
  hooksAfterGuard,
  [],
  `Home must call every React/custom hook before the logged-out return; found ${hooksAfterGuard.join(", ")}`,
);
console.log("test:page-hook-order — Home hooks remain unconditional across authentication changes");
