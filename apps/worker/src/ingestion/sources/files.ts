import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { SourceDocumentInput } from "../document";

/**
 * Markdown sources with front matter.
 *
 * The corpus most of this application uses is derived from the curriculum
 * (see sources/derived.ts), but material that is genuinely prose — cultural
 * notes, dialogues, situational language — is easier to write and review as a
 * file than as a TypeScript literal. This is how one gets in.
 *
 * The front-matter parser is deliberately tiny and deliberately strict. A full
 * YAML parser is a dependency, a parsing surface, and a way for a typo to
 * become a silently different value; every field here is a scalar, and
 * anything that is not one is an error rather than a guess. Whatever it
 * produces is validated against the document schema afterwards, so a wrong
 * CEFR band fails ingestion instead of reaching the wrong learner.
 */

const DELIMITER = "---";

export class FrontMatterError extends Error {
  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = "FrontMatterError";
  }
}

function parseScalar(raw: string): string | number | boolean | null {
  const value = raw.trim();

  if (value === "" || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;

  const quoted = /^(["'])(.*)\1$/u.exec(value);
  if (quoted) return quoted[2];

  if (/^-?\d+$/u.test(value)) return Number(value);

  return value;
}

export interface ParsedFile {
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly body: string;
}

export function parseFrontMatter(file: string, raw: string): ParsedFile {
  const text = raw.replace(/\r\n?/gu, "\n");

  if (!text.startsWith(`${DELIMITER}\n`)) {
    throw new FrontMatterError(file, "must begin with a front-matter block");
  }

  const end = text.indexOf(`\n${DELIMITER}`, DELIMITER.length);
  if (end === -1) {
    throw new FrontMatterError(file, "front-matter block is not closed");
  }

  const head = text.slice(DELIMITER.length + 1, end);
  // Blank lines between the closing delimiter and the first paragraph are
  // formatting, not content.
  const body = text.slice(end + DELIMITER.length + 1).replace(/^\n+/u, "");
  const attributes: Record<string, string | number | boolean | null> = {};

  for (const [number, line] of head.split("\n").entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new FrontMatterError(file, `line ${number + 1} is not "key: value"`);
    }

    const key = line.slice(0, separator).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(key)) {
      throw new FrontMatterError(file, `"${key}" is not a valid field name`);
    }

    attributes[key] = parseScalar(line.slice(separator + 1));
  }

  return { attributes, body };
}

/**
 * A file's identity.
 *
 * The path relative to the corpus root, with separators normalised, so the
 * same file ingested from a different checkout is the same document. An
 * absolute path would make every machine's corpus look like a different one.
 */
export function sourceIdFor(root: string, file: string): string {
  return `content/${relative(root, file).split(sep).join("/")}`;
}

export function documentFromFile(
  root: string,
  file: string,
  raw: string,
): SourceDocumentInput {
  const { attributes, body } = parseFrontMatter(file, raw);

  const {
    title,
    contentType,
    language,
    cefr,
    miniLevel,
    topic,
    skill,
    grammarTarget,
    difficulty,
    license,
    attribution,
    ...rest
  } = attributes;

  return {
    source: sourceIdFor(root, file),
    title: title as string,
    contentType: contentType as SourceDocumentInput["contentType"],
    language: (language ?? "de") as SourceDocumentInput["language"],
    cefr: cefr as SourceDocumentInput["cefr"],
    miniLevel: miniLevel as SourceDocumentInput["miniLevel"],
    topic: topic as SourceDocumentInput["topic"],
    skill: skill as SourceDocumentInput["skill"],
    grammarTarget: grammarTarget as SourceDocumentInput["grammarTarget"],
    difficulty: difficulty as SourceDocumentInput["difficulty"],
    license: license as SourceDocumentInput["license"],
    attribution: attribution as SourceDocumentInput["attribution"],
    body,
    // Anything else the author wrote travels along rather than being dropped.
    // It is not filtered on, so it does not need a schema of its own.
    metadata: rest,
  };
}

function markdownFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string) => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      // A missing corpus directory is an empty corpus, not a failure: the
      // derived sources are the ones this application cannot run without.
      return;
    }

    for (const entry of entries.sort()) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) found.push(full);
    }
  };

  walk(root);
  return found;
}

export function fileDocuments(root: string): readonly SourceDocumentInput[] {
  return markdownFiles(root).map((file) =>
    documentFromFile(root, file, readFileSync(file, "utf8")),
  );
}
