// In-memory Jira Cloud stand-in: just enough of REST v3 to exercise the handlers.
import { JiraClient } from "../src/jira.js";

export const ME = { accountId: "5b10ac8d82e05b22cc7d4ef5", displayName: "Duc Nguyen" };
export const REVIEWER = { accountId: "5b10ac8d82e05b22cc7d4ef6", displayName: "Khanh Nguyen" };

const FIELDS = [
  { id: "customfield_10015", name: "Start date", custom: true, schema: { type: "date" } },
  { id: "customfield_20001", name: "Planned End Date", custom: true, schema: { type: "date" } },
  { id: "customfield_20002", name: "Reviewer", custom: true, schema: { type: "user" } },
  { id: "customfield_20003", name: "Evidence", custom: true, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea" } },
  { id: "customfield_10016", name: "Story point estimate", custom: true, schema: { type: "number" } },
  { id: "customfield_10021", name: "Flagged", custom: true, schema: { type: "array" } },
];
const STATUS_ORDER = ["Backlog", "To Do", "In Progress", "In Review", "Done", "Cancelled"];

export type Call = { method: string; path: string; body?: any };

export function makeFake(opts: { as?: typeof ME } = {}) {
  const me = opts.as ?? ME;
  const calls: Call[] = [];
  const issues = new Map<string, any>();
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  const fetchImpl = (async (input: any, init: any = {}) => {
    const u = new URL(String(input));
    const path = u.pathname + u.search;
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === "/rest/api/3/myself") return json(200, me);
    if (path === "/rest/api/3/field") return json(200, FIELDS);
    if (u.pathname === "/rest/api/3/user/search") {
      const q = (u.searchParams.get("query") ?? "").toLowerCase();
      return json(200, [ME, REVIEWER].filter((x) => x.displayName.toLowerCase().includes(q)).map((x) => ({ ...x, active: true, accountType: "atlassian" })));
    }
    if (method === "POST" && u.pathname === "/rest/api/3/issue") {
      const key = `${body.fields.project.key}-${++n}`;
      issues.set(key, { id: String(n), key, fields: { ...body.fields, status: { name: "Backlog" } } });
      return json(201, { id: String(n), key });
    }
    const m = u.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/\w+)?$/);
    if (m) {
      const issue = issues.get(m[1]!);
      if (!issue) return json(404, { errorMessages: ["Issue does not exist"] });
      if (!m[2] && method === "GET") {
        // Real Jira expands user fields to full objects on read.
        const dir = new Map([ME, REVIEWER].map((x) => [x.accountId, x]));
        const expand = (v: any): any => (v?.accountId && !v.displayName ? { ...v, ...dir.get(v.accountId) } : v);
        const fields = Object.fromEntries(Object.entries(issue.fields).map(([k, v]) => [k, Array.isArray(v) ? v.map(expand) : expand(v)]));
        return json(200, { ...issue, fields });
      }
      if (!m[2] && method === "PUT") { Object.assign(issue.fields, body.fields); return new Response(null, { status: 204 }); }
      if (m[2] === "/comment") { (issue.comments ??= []).push(body.body); return json(201, {}); }
      if (m[2] === "/transitions" && method === "GET")
        return json(200, { transitions: STATUS_ORDER.filter((s) => s !== issue.fields.status.name).map((s) => ({ id: `t-${s}`, name: s, to: { name: s } })) });
      if (m[2] === "/transitions" && method === "POST") {
        const to = body.transition.id.slice(2);
        const f = issue.fields;
        // Mirror the validators the convention says Jira enforces.
        if (to === "To Do" && (!f.assignee || !f.customfield_10015 || !f.customfield_20001)) return json(400, { errorMessages: ["validator: To Do needs Assignee/Start/Planned End"] });
        if (to === "In Review" && (!f.customfield_20002 || !f.customfield_20003)) return json(400, { errorMessages: ["validator: In Review needs Reviewer+Evidence"] });
        f.status = { name: to };
        return new Response(null, { status: 204 });
      }
    }
    return json(404, { errorMessages: [`fake: unhandled ${method} ${path}`] });
  }) as typeof fetch;

  const client = new JiraClient({ baseUrl: "https://example.atlassian.net", email: "a@b.c", apiToken: "t" }, fetchImpl);
  return { client, calls, issues };
}
