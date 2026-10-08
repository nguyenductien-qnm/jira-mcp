// Minimal Atlassian Document Format helpers: build descriptions/comments and flatten ADF back to text.
import { randomUUID } from "node:crypto";

export type Adf = { type: "doc"; version: 1; content: AdfNode[] };
export type AdfNode = { type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; text?: string; marks?: { type: string }[] };

export const text = (t: string, bold = false): AdfNode => ({ type: "text", text: t, ...(bold ? { marks: [{ type: "strong" }] } : {}) });
export const para = (...children: AdfNode[]): AdfNode => ({ type: "paragraph", content: children });
export const label = (t: string): AdfNode => para(text(t, true));
export const bullets = (items: string[]): AdfNode => ({
  type: "bulletList",
  content: items.map((i) => ({ type: "listItem", content: [para(text(i))] })),
});
export const ordered = (items: string[]): AdfNode => ({
  type: "orderedList",
  content: items.map((i) => ({ type: "listItem", content: [para(text(i))] })),
});
export const checklist = (items: string[]): AdfNode => ({
  type: "taskList",
  attrs: { localId: randomUUID() },
  content: items.map((i) => ({ type: "taskItem", attrs: { localId: randomUUID(), state: "TODO" }, content: [text(i)] })),
});
export const doc = (...content: AdfNode[]): Adf => ({ type: "doc", version: 1, content });

/** Plain multi-line text -> ADF, one paragraph per line (blank lines dropped). */
export function textToAdf(s: string): Adf {
  const lines = s.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
  return doc(...(lines.length ? lines.map((l) => para(text(l))) : [para()]));
}

export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  const n = node as AdfNode;
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  const inner = (n.content ?? []).map(adfToText);
  switch (n.type) {
    case "doc":
      return inner.join("\n").trim();
    case "paragraph":
    case "heading":
      return inner.join("");
    case "listItem":
      return inner.join(" ");
    case "taskItem":
      return `[${n.attrs?.state === "DONE" ? "x" : " "}] ${inner.join("")}`;
    case "bulletList":
    case "taskList":
      return (n.content ?? []).map((c) => `- ${adfToText(c)}`).join("\n");
    case "orderedList":
      return (n.content ?? []).map((c, i) => `${i + 1}. ${adfToText(c)}`).join("\n");
    default:
      return inner.join("\n");
  }
}
