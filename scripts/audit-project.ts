import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { cardSchema } from "../src/types/card";
import { playableErrors } from "../src/game/capabilities";

// Static, offline audit of authored files; never loads .env or connects to MongoDB.
export async function auditProject(root = path.resolve(__dirname, "..")) {
  const files: string[] = [];
  const scan = async (folder: string) => {
    for (const entry of await readdir(path.join(root, folder), {
      withFileTypes: true,
    })) {
      const name = path.posix.join(folder, entry.name);
      if (entry.isDirectory()) await scan(name);
      else files.push(name);
    }
  };
  for (const folder of ["src", "public", "tests", "scripts", ".github"])
    await scan(folder);
  files.push(
    "README.md",
    "GUIA_DO_PROJETO.txt",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.check.json",
    "vercel.json",
    ".gitignore",
    ".gitattributes",
    ".prettierignore",
    ".vercelignore",
    ".env.example",
  );
  const known = new Set(files),
    errors: string[] = [],
    references = new Map<string, string[]>();
  const referencedAssets = new Set<string>();
  const texts = new Map<string, string>();
  for (const file of files.filter((f) =>
    /\.(ts|js|css|html|json|txt|md)$/.test(f),
  ))
    texts.set(file, await readFile(path.join(root, file), "utf8"));
  const link = (source: string, target: string) => {
    if (!known.has(target)) {
      errors.push(
        `${source}: referência ausente ou com capitalização incorreta: ${target}`,
      );
      return;
    }
    references.set(source, [...(references.get(source) ?? []), target]);
    if (target.startsWith("public/assets/")) referencedAssets.add(target);
  };
  for (const [file, text] of texts) {
    if (/\.(ts|js)$/.test(file)) {
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
      );
      const imports = source.statements.flatMap((statement) => {
        if (
          (ts.isImportDeclaration(statement) ||
            ts.isExportDeclaration(statement)) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        )
          return [statement.moduleSpecifier.text];
        return [];
      });
      for (const specifier of imports.filter((s) => s.startsWith("."))) {
        const base = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        );
        const target = [
          base,
          base + ".ts",
          base + ".json",
          base + "/index.ts",
        ].find((f) => known.has(f));
        link(file, target ?? base);
      }
    }
    if (file.endsWith(".html")) {
      for (const match of text.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
        const url = match[1];
        if (
          url.startsWith("/JS/") ||
          url.startsWith("/CSS/") ||
          url.startsWith("/assets/") ||
          url.startsWith("/HTML/")
        )
          link(file, "public" + decodeURI(url));
      }
    }
    if (file.startsWith("public/JS/")) {
      // Captures literal/dynamic-prefix icon and appearance maps independently of HTML.
      for (const match of text.matchAll(/["'`]\/assets\/([^"'`$]+)["'`]/g))
        link(file, "public/assets/" + match[1]);
    }
    if (file.endsWith(".css")) {
      for (const match of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const url = match[1];
        if (/^(data:|https?:)/.test(url)) continue;
        link(
          file,
          url.startsWith("/")
            ? "public" + decodeURI(url)
            : path.posix.normalize(
                path.posix.join(path.posix.dirname(file), decodeURI(url)),
              ),
        );
      }
    }
  }
  const reachable = (entries: string[]) => {
    const visited = new Set<string>();
    const visit = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      for (const target of references.get(file) ?? []) visit(target);
    };
    entries.forEach(visit);
    return visited;
  };
  const server = reachable(["src/server.ts"]);
  const browser = reachable(
    files.filter((f) => f.startsWith("public/HTML/") && f.endsWith(".html")),
  );
  for (const file of files.filter(
    (f) => f.startsWith("src/") && f.endsWith(".ts"),
  ))
    if (!server.has(file))
      errors.push(
        `${file}: código de servidor sem caminho desde o entrypoint.`,
      );
  for (const file of files.filter((f) => /^public\/(JS|CSS)\//.test(f)))
    if (!browser.has(file))
      errors.push(`${file}: módulo ou estilo sem referência das páginas.`);
  const rawCatalog = JSON.parse(texts.get("src/data/catalog.json")!);
  const catalog = rawCatalog.map((raw: unknown) => cardSchema.parse(raw));
  const ids = new Set<string>();
  for (const card of catalog) {
    if (ids.has(card.numeroCatalogo))
      errors.push(`Número de catálogo duplicado: ${card.numeroCatalogo}`);
    ids.add(card.numeroCatalogo);
    if (card.publicado)
      for (const error of playableErrors(card))
        errors.push(`${card.numeroCatalogo}: ${error}`);
    if (card.imgURL?.startsWith("/"))
      link("src/data/catalog.json", "public" + decodeURI(card.imgURL));
  }
  // These URLs are assembled at runtime; their enumerated variants need exact files too.
  for (const name of ["common", "zarcos", "water", "air", "fire", "earth"])
    link("public/JS/card-backs.js", `public/assets/card-backs/${name}.png`);
  for (const name of [
    "neutro",
    "agua",
    "ar",
    "fogo",
    "terra",
    "zarcos",
    "tropa",
    "feitiço",
  ])
    link("public/JS/deck-appearance.js", `public/assets/icons/${name}.svg`);
  const guide = texts.get("GUIA_DO_PROJETO.txt")!;
  for (const file of files)
    if (!guide.includes(`- ${file} — `))
      errors.push(`${file}: falta descrição específica no guia.`);
  const authoredMarkdown = (await readdir(root)).filter(
    (f) => /\.md$/i.test(f) && f !== "README.md",
  );
  authoredMarkdown.push(
    ...files.filter((f) => /\.md$/i.test(f) && f !== "README.md"),
  );
  for (const file of authoredMarkdown)
    errors.push(`${file}: documentação deve ser consolidada no README/guia.`);
  return {
    files: files.length,
    serverModules: server.size,
    browserFiles: browser.size,
    cards: catalog.length,
    published: catalog.filter((c: { publicado: boolean }) => c.publicado)
      .length,
    reservedAssets: files.filter(
      (f) => f.startsWith("public/assets/") && !referencedAssets.has(f),
    ),
    errors,
  };
}

if (require.main === module)
  void auditProject()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.errors.length) process.exitCode = 1;
    })
    .catch((error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
