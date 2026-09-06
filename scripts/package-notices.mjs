import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

export async function writePackageNotices(root, destination) {
  const js = JSON.parse(
    (
      await runAcceptanceProcess(
        "pnpm",
        ["licenses", "list", "--prod", "--json"],
        { cwd: root },
      )
    ).stdout,
  );
  const host = (
    await runAcceptanceProcess("rustc", ["-vV"], { cwd: root })
  ).stdout.match(/^host: (.+)$/m)?.[1];
  assert.ok(host);
  const rust = JSON.parse(
    (
      await runAcceptanceProcess(
        "cargo",
        [
          "metadata",
          "--format-version",
          "1",
          "--locked",
          "--offline",
          "--filter-platform",
          host,
        ],
        { cwd: root, maxBuffer: 8 * 1024 * 1024 },
      )
    ).stdout,
  );
  const workspaces = new Set(rust.workspace_members);
  const nodes = new Map(rust.resolve.nodes.map((node) => [node.id, node]));
  const included = new Set();
  function visit(id) {
    if (included.has(id)) return;
    included.add(id);
    for (const dependency of nodes.get(id)?.deps ?? []) {
      if (dependency.dep_kinds.some((kind) => kind.kind !== "dev"))
        visit(dependency.pkg);
    }
  }
  for (const item of rust.packages.filter(
    (item) =>
      workspaces.has(item.id) && ["drogond", "drogon-cli"].includes(item.name),
  ))
    visit(item.id);
  const packages = [
    ...Object.values(js)
      .flat()
      .flatMap((item) =>
        item.paths.map((directory) => ({
          name: item.name,
          version: item.versions.join(", "),
          license: item.license,
          directory,
        })),
      ),
    ...rust.packages
      .filter((item) => included.has(item.id) && !workspaces.has(item.id))
      .map((item) => ({
        name: item.name,
        version: item.version,
        license: item.license,
        directory: path.dirname(item.manifest_path),
      })),
  ];
  const notices = [
    await readFile(path.join(root, "LICENSE"), "utf8"),
    await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8"),
  ];
  const seen = new Set();
  const missing = [];
  for (const item of packages.sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const key = `${item.name}@${item.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const files = (
      await readdir(item.directory, { withFileTypes: true })
    ).filter(
      (file) =>
        file.isFile() &&
        /^(licen[cs]e|copying|notice|ofl)([._-]|$)/i.test(file.name),
    );
    notices.push(`\n\n## ${key} — ${item.license}\n`);
    if (!files.length) {
      if (key === "react-remove-scroll-bar@2.3.8") {
        notices.push(
          "Source: https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE\n",
        );
        notices.push(
          await readFile(
            path.join(
              root,
              "third-party",
              "licenses",
              `${key.replace("@", "-")}.txt`,
            ),
            "utf8",
          ),
        );
      } else missing.push(key);
    }
    for (const file of files.sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      notices.push(
        `### ${file.name}\n${await readFile(path.join(item.directory, file.name), "utf8")}`,
      );
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Missing local license texts: ${missing.join(", ")}`,
  );
  await writeFile(destination, notices.join("\n"));
  return seen.size;
}
