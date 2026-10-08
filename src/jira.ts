// Thin Jira Cloud REST v3 client. Auth is Basic email:API token, read from the environment only.
import { adfToText, type Adf } from "./adf.js";

export type Config = { baseUrl: string; email: string; apiToken: string; defaultProject?: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = (env.JIRA_BASE_URL ?? "https://xbrainvn.atlassian.net").replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/.test(baseUrl)) throw new Error(`JIRA_BASE_URL phải dạng https://<site>.atlassian.net, nhận "${baseUrl}"`);
  const email = env.JIRA_EMAIL?.trim();
  const apiToken = env.JIRA_API_TOKEN?.trim();
  if (!email || !apiToken) throw new Error("Thiếu JIRA_EMAIL hoặc JIRA_API_TOKEN trong environment (tạo token tại https://id.atlassian.com/manage-profile/security/api-tokens).");
  return { baseUrl, email, apiToken, defaultProject: env.JIRA_DEFAULT_PROJECT?.trim() || undefined };
}

export class JiraError extends Error {
  constructor(public status: number, public detail: string, public method: string, public path: string) {
    super(`Jira ${method} ${path} -> ${status}: ${detail}`);
  }
}

export type FieldDef = { id: string; name: string; custom?: boolean; schema?: { type?: string; custom?: string } };
export type FetchLike = typeof fetch;

export const FIELD_NAMES = {
  startDate: ["Start date"],
  plannedEndDate: ["Planned End Date"],
  reviewer: ["Reviewer"],
  evidence: ["Evidence"],
  storyPoints: ["Story point estimate", "Story Points"],
  flagged: ["Flagged"],
} as const;
export type FieldKey = keyof typeof FIELD_NAMES;

export class JiraClient {
  private fieldCache?: FieldDef[];
  private me?: { accountId: string; displayName: string; emailAddress?: string };

  constructor(public cfg: Config, private fetchImpl: FetchLike = fetch) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString("base64")}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();
    if (!res.ok) throw new JiraError(res.status, flattenError(raw), method, path);
    return (raw ? JSON.parse(raw) : undefined) as T;
  }

  url(key: string) {
    return `${this.cfg.baseUrl}/browse/${key}`;
  }

  async myself(): Promise<{ accountId: string; displayName: string; emailAddress?: string }> {
    this.me ??= await this.request<{ accountId: string; displayName: string; emailAddress?: string }>("GET", "/rest/api/3/myself");
    return this.me;
  }

  async fields(): Promise<FieldDef[]> {
    return (this.fieldCache ??= await this.request<FieldDef[]>("GET", "/rest/api/3/field"));
  }

  async field(key: FieldKey, required = false): Promise<FieldDef | undefined> {
    const all = await this.fields();
    const wanted = FIELD_NAMES[key].map((n) => n.toLowerCase());
    const hit = all.find((f) => wanted.includes(f.name.toLowerCase()));
    if (!hit && required)
      throw new Error(`Không tìm thấy field "${FIELD_NAMES[key].join('" / "')}" trên Jira site này. Nhờ admin kiểm tra cấu hình field theo convention.`);
    return hit;
  }

  /** Resolve "me", an accountId, or a name/email to exactly one accountId. */
  async resolveUser(ref: string): Promise<{ accountId: string; displayName: string }> {
    if (ref.toLowerCase() === "me") return this.myself();
    if (ref.length >= 20 && /^[A-Za-z0-9:_-]+$/.test(ref)) return { accountId: ref, displayName: ref };
    const found = await this.request<{ accountId: string; displayName: string; active?: boolean; accountType?: string }[]>(
      "GET", `/rest/api/3/user/search?query=${encodeURIComponent(ref)}&maxResults=10`);
    const people = found.filter((u) => u.active !== false && (u.accountType ?? "atlassian") === "atlassian");
    const exact = people.filter((u) => u.displayName.toLowerCase() === ref.toLowerCase());
    const pick = exact.length === 1 ? exact : people;
    if (pick.length === 1) return pick[0]!;
    if (pick.length === 0) throw new Error(`Không tìm thấy user "${ref}".`);
    throw new Error(`"${ref}" khớp nhiều user: ${pick.map((u) => `${u.displayName} (${u.accountId})`).join("; ")}. Truyền accountId cụ thể.`);
  }

  async userFieldValue(field: FieldDef, accountId: string) {
    return field.schema?.type === "array" ? [{ accountId }] : { accountId };
  }

  /** Paragraph custom fields take ADF on v3; single-line text fields take a string. */
  textFieldValue(field: FieldDef, value: string, asAdf: (s: string) => Adf) {
    return field.schema?.custom?.endsWith(":textfield") ? value : asAdf(value);
  }

  async getIssue(key: string, fields: string[]) {
    return this.request<RawIssue>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(",")}`);
  }

  createIssue(fields: Record<string, unknown>) {
    return this.request<{ id: string; key: string }>("POST", "/rest/api/3/issue", { fields });
  }

  updateIssue(key: string, fields: Record<string, unknown>) {
    return this.request("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
  }

  addComment(key: string, body: Adf) {
    return this.request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body });
  }

  transitions(key: string) {
    return this.request<{ transitions: { id: string; name: string; to: { name: string } }[] }>(
      "GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`).then((r) => r.transitions);
  }

  transition(key: string, id: string) {
    return this.request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id } });
  }

  async search(jql: string, fields: string[], maxResults = 25) {
    const r = await this.request<{ issues: RawIssue[]; isLast?: boolean }>("POST", "/rest/api/3/search/jql", { jql, fields, maxResults });
    return r;
  }
}

export type RawIssue = { id: string; key: string; fields: Record<string, any> };

function flattenError(raw: string): string {
  try {
    const j = JSON.parse(raw);
    const parts = [...(j.errorMessages ?? []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
    if (parts.length) return parts.join("; ");
  } catch { /* not JSON */ }
  return raw.slice(0, 300) || "(empty body)";
}

export type IssueView = {
  key: string; url: string; type?: string; summary: string; status: string; priority?: string;
  assignee?: { id: string; name: string }; reviewer?: { id: string; name: string };
  parent?: string; startDate?: string; plannedEndDate?: string; dueDate?: string;
  labels: string[]; components: string[]; storyPoints?: number; flagged: boolean;
  evidence?: string; description?: string;
};

/** Field ids Jira needs to fetch an issue in the shape IssueView expects. */
export async function viewFields(c: JiraClient): Promise<{ ids: string[]; map: Partial<Record<FieldKey, FieldDef>> }> {
  const map: Partial<Record<FieldKey, FieldDef>> = {};
  for (const k of Object.keys(FIELD_NAMES) as FieldKey[]) {
    const f = await c.field(k);
    if (f) map[k] = f;
  }
  const ids = ["summary", "status", "issuetype", "priority", "assignee", "parent", "duedate", "labels", "components", "description",
    ...Object.values(map).map((f) => f!.id)];
  return { ids, map };
}

export function toView(c: JiraClient, raw: RawIssue, map: Partial<Record<FieldKey, FieldDef>>): IssueView {
  const f = raw.fields;
  const get = (k: FieldKey) => (map[k] ? f[map[k]!.id] : undefined);
  const user = (u: any) => (u ? { id: u.accountId as string, name: u.displayName as string } : undefined);
  const rev = get("reviewer");
  const ev = get("evidence");
  const flagged = get("flagged");
  return {
    key: raw.key,
    url: c.url(raw.key),
    type: f.issuetype?.name,
    summary: f.summary ?? "",
    status: f.status?.name ?? "",
    priority: f.priority?.name,
    assignee: user(f.assignee),
    reviewer: user(Array.isArray(rev) ? rev[0] : rev),
    parent: f.parent?.key,
    startDate: get("startDate") ?? undefined,
    plannedEndDate: get("plannedEndDate") ?? undefined,
    dueDate: f.duedate ?? undefined,
    labels: f.labels ?? [],
    components: (f.components ?? []).map((x: any) => x.name),
    storyPoints: get("storyPoints") ?? undefined,
    flagged: Array.isArray(flagged) ? flagged.length > 0 : !!flagged,
    evidence: ev ? (typeof ev === "string" ? ev : adfToText(ev)) : undefined,
    description: f.description ? adfToText(f.description) : undefined,
  };
}
