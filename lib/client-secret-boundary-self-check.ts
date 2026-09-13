import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["app", "components", "lib"];
const allowedClientEnv = new Set([
  "NODE_ENV",
  "SUPABASE_STORAGE_BUCKET",
]);
const privilegedModules = [
  "lib/cron-auth.ts",
  "lib/doku.ts",
  "lib/instagram.ts",
  "lib/replicate-utils.ts",
  "lib/rendi.ts",
  "lib/supabase-server.ts",
  "lib/supabase.ts",
  "lib/tiktok.ts",
  "lib/youtube.ts",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    const stat = statSync(absolute);
    if (stat.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(name) ? [absolute] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isClientRoot(file: string): boolean {
  for (const statement of parse(file).statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function importHasRuntimeValue(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
  }
  return Boolean(clause.namedBindings);
}

function exportHasRuntimeValue(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.some((element) => !element.isTypeOnly);
  }
  return true;
}

function runtimeImports(file: string): string[] {
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      importHasRuntimeValue(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      exportHasRuntimeValue(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return imports;
}

function resolveLocalImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(root, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next supported source-file shape.
    }
  }
  return null;
}

function isProcessEnv(
  node: ts.Node | undefined,
): node is ts.PropertyAccessExpression {
  return Boolean(
    node &&
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

function processEnvNames(file: string): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      isProcessEnv(node.expression)
    ) {
      names.push(node.name.text);
      return;
    }
    if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
      const key = node.argumentExpression;
      names.push(
        key &&
          (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))
          ? key.text
          : "<dynamic>",
      );
      return;
    }
    if (ts.isVariableDeclaration(node) && isProcessEnv(node.initializer)) {
      if (!ts.isObjectBindingPattern(node.name)) {
        names.push("<dynamic>");
        return;
      }
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        names.push(
          !element.dotDotDotToken &&
            (ts.isIdentifier(key) || ts.isStringLiteral(key))
            ? key.text
            : "<dynamic>",
        );
      }
      return;
    }
    if (isProcessEnv(node)) {
      names.push("<dynamic>");
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return names;
}

const allSources = sourceRoots.flatMap((directory) =>
  sourceFiles(path.join(root, directory)),
);
for (const modulePath of privilegedModules) {
  assert.match(
    readFileSync(path.join(root, modulePath), "utf8"),
    /^import ["']server-only["'];/m,
    `${modulePath} must fail closed if imported by a Client Component`,
  );
}

const queue = allSources.filter(isClientRoot);
const reachable = new Set<string>();

while (queue.length > 0) {
  const file = queue.pop()!;
  if (reachable.has(file)) continue;
  reachable.add(file);

  for (const specifier of runtimeImports(file)) {
    assert.notEqual(
      specifier,
      "server-only",
      `client graph reaches server-only module ${path.relative(root, file)}`,
    );
    assert(
      !specifier.startsWith("node:"),
      `client graph imports server runtime ${specifier} from ${path.relative(root, file)}`,
    );
    const local = resolveLocalImport(file, specifier);
    if (local && !reachable.has(local)) queue.push(local);
  }
}

for (const file of reachable) {
  for (const name of processEnvNames(file)) {
    assert(
      name.startsWith("NEXT_PUBLIC_") || allowedClientEnv.has(name),
      `client graph reads server env ${name} in ${path.relative(root, file)}`,
    );
  }
}

const storageBuckets = readFileSync(
  path.join(root, "lib/storage-buckets.ts"),
  "utf8",
);
assert.doesNotMatch(
  storageBuckets,
  /from ["']@\/lib\/supabase-server["']/,
  "client-safe storage path helpers must not import the service-role client",
);

const nextConfig = readFileSync(path.join(root, "next.config.mjs"), "utf8");
assert.doesNotMatch(
  nextConfig,
  /productionBrowserSourceMaps\s*:\s*true/,
  "production browser source maps must stay disabled",
);
assert.doesNotMatch(
  nextConfig,
  /SUPABASE_SERVICE_ROLE_KEY|REPLICATE_API_TOKEN|RENDI_API_KEY|DOKU_SECRET_KEY/,
  "Next config must not inline server credentials",
);

const readme = readFileSync(path.join(root, "README.md"), "utf8");
assert.match(
  readme,
  /SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key/,
  "setup docs must identify the required server-side Supabase credential",
);
assert.match(
  readme,
  /Never expose[^.]*SUPABASE_SERVICE_ROLE_KEY[^.]*NEXT_PUBLIC_/,
  "setup docs must explain that the service role is never browser-safe",
);
assert.doesNotMatch(
  readme,
  /Create one \*\*public\*\* Supabase Storage bucket/,
  "setup docs must not instruct operators to expose the private media bucket",
);

const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
assert.match(
  gitignore,
  /^\.env\*$/m,
  "all dotenv variants must be ignored, not only .env*.local",
);
for (const extension of ["pem", "key", "p12", "pfx"]) {
  assert(
    gitignore.split(/\r?\n/).includes(`*.${extension}`),
    `*.${extension} private-key material must be ignored`,
  );
}

console.log(
  `client secret boundary self-check passed (${reachable.size} client-reachable modules)`,
);
