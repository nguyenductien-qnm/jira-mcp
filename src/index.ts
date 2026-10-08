#!/usr/bin/env node
// MCP stdio server: logs Jira issues following the Jira Sprint Convention v1.1.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ISSUE_TYPES, PRIORITIES, STATUSES, PRESET_JQL } from "./convention.js";
import * as h from "./handlers.js";
import { JiraClient, JiraError, loadConfig } from "./jira.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const description = z.object({
  context: z.string().optional().describe("Story/Task/Sub-task: bối cảnh, vì sao cần làm"),
  requirements: z.array(z.string()).optional().describe("Story/Task: yêu cầu, cần làm gì"),
  acceptanceCriteria: z.array(z.string()).optional().describe("Story/Task: điều kiện để coi là xong (bắt buộc)"),
  steps: z.array(z.string()).optional().describe("Bug: các bước tái hiện"),
  actual: z.string().optional().describe("Bug: kết quả thực tế"),
  expected: z.string().optional().describe("Bug: kết quả mong đợi"),
  environment: z.string().optional().describe("Bug: trình duyệt, thiết bị, link, ảnh"),
  goal: z.string().optional().describe("Epic: mục tiêu, giải quyết vấn đề gì cho ai"),
  doneCriteria: z.array(z.string()).optional().describe("Epic: tiêu chí hoàn thành đo được"),
  inScope: z.array(z.string()).optional(),
  outOfScope: z.array(z.string()).optional(),
  links: z.array(z.string()).optional().describe("Epic: link Confluence/Figma/Drive"),
});
const evidence = z.object({
  result: z.string().describe("Đã đạt được gì so với tiêu chí hoàn thành"),
  proof: z.array(z.string()).describe("Link tài liệu / PR / test / dashboard / ảnh. Không đưa secret"),
  contribution: z.string().optional().describe("Ai làm phần nào, nếu nhiều người tham gia"),
});
const key = z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/, "issue key dạng XAI-12");

const server = new McpServer({ name: "jira-mcp", version: "0.1.0" });
let client: JiraClient | undefined;
const jira = () => (client ??= new JiraClient(loadConfig()));

type Run = () => Promise<h.Result>;
async function respond(run: Run) {
  try {
    const r = await run();
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }], isError: !r.ok };
  } catch (e) {
    const msg = e instanceof JiraError ? `${e.message}${e.status === 401 || e.status === 403 ? " (kiểm tra JIRA_EMAIL / JIRA_API_TOKEN và quyền)" : ""}` : (e as Error).message;
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, errors: [msg] }, null, 2) }], isError: true };
  }
}

server.registerTool("jira_whoami", {
  description: "Kiểm tra kết nối Jira, trả về user hiện tại và field nào của convention (Start date, Planned End Date, Reviewer, Evidence) còn thiếu trên site.",
  inputSchema: {},
}, () => respond(() => h.whoami(jira())));

server.registerTool("jira_create_issue", {
  description: "Tạo Epic/Story/Task/Bug/Sub-task đúng convention: kiểm tra mẫu tên, Parent, ngày, Acceptance criteria, rồi dựng description theo template. Dùng dryRun=true trước để xem payload. Ticket mới vào Backlog; moveToTodo=true chuyển luôn sang To Do khi đạt Definition of Ready.",
  inputSchema: {
    type: z.enum(ISSUE_TYPES),
    project: z.string().optional().describe("Key space: SDO, XDO, XAI, AIQT, XDE (mặc định JIRA_DEFAULT_PROJECT)"),
    summary: z.string().describe("Epic: `[Mảng] Kết quả`. Story: `Vai trò có thể hành động`. Bug: `[Bug] Chỗ lỗi: hiện tượng`. Task/Sub-task: `Động từ đối tượng`"),
    description,
    parent: key.optional().describe("Epic cha (Story/Task/Bug) hoặc issue cha (Sub-task). Epic không có parent"),
    assignee: z.string().optional().describe('"me", accountId, hoặc tên/email, đúng 1 người'),
    reviewer: z.string().optional().describe("Phải khác assignee"),
    startDate: date.optional(), plannedEndDate: date.optional(), dueDate: date.optional().describe("Chỉ khi có deadline cam kết"),
    priority: z.enum(PRIORITIES).optional(),
    component: z.string().optional().describe("Đúng 1 component, cũng là {Mảng} của tên epic"),
    labels: z.array(z.string()).optional(),
    storyPoints: z.number().optional().describe("Fibonacci 1,2,3,5,8; từ 13 phải tách"),
    moveToTodo: z.boolean().optional(), dryRun: z.boolean().optional(),
  },
}, (a) => respond(() => h.createIssue(jira(), a)));

server.registerTool("jira_update_issue", {
  description: "Cập nhật field của issue có sẵn: assignee, reviewer, ngày, priority, labels, story points, evidence (theo mẫu Kết quả/Bằng chứng/Đóng góp), flag blocked. Đổi ngày/scope hoặc flag cần comment lý do.",
  inputSchema: {
    key, summary: z.string().optional(), assignee: z.string().optional(), reviewer: z.string().optional(),
    startDate: date.optional(), plannedEndDate: date.optional(), dueDate: date.optional(),
    priority: z.enum(PRIORITIES).optional(), labels: z.array(z.string()).optional(), storyPoints: z.number().optional(),
    evidence: evidence.optional(),
    flagged: z.boolean().optional().describe("true = Add flag (blocked), false = bỏ flag. Cần comment"),
    comment: z.string().optional().describe("Lý do đổi ngày/scope, hoặc lý do flag"),
  },
}, (a) => respond(() => h.updateIssue(jira(), a)));

server.registerTool("jira_transition_issue", {
  description: "Chuyển status theo rule: To Do cần Assignee+Start+Planned End; In Review cần Reviewer (khác Assignee)+Evidence; Done cần Evidence và chỉ Reviewer được chuyển; Cancelled/Backlog cần comment lý do. Có thể truyền kèm evidence/reviewer/ngày để set và chuyển trong một lần.",
  inputSchema: {
    key, to: z.enum(STATUSES),
    assignee: z.string().optional(), reviewer: z.string().optional(),
    startDate: date.optional(), plannedEndDate: date.optional(), priority: z.enum(PRIORITIES).optional(),
    evidence: evidence.optional(), comment: z.string().optional(),
  },
}, (a) => respond(() => h.transitionIssue(jira(), a)));

server.registerTool("jira_get_issue", {
  description: "Đọc một issue: status, assignee, reviewer, parent, ngày, evidence, description.",
  inputSchema: { key },
}, ({ key }) => respond(() => h.getIssue(jira(), key)));

server.registerTool("jira_validate_issue", {
  description: "Kiểm tra issue có sẵn theo convention (mẫu tên, Parent, ngày, Acceptance criteria, Reviewer/Evidence theo status) và trả danh sách lỗi cần sửa.",
  inputSchema: { key },
}, ({ key }) => respond(() => h.validateIssue(jira(), key)));

server.registerTool("jira_search", {
  description: `Tìm issue bằng JQL tự do hoặc preset: ${Object.keys(PRESET_JQL).join(", ")}. Dùng để tìm Epic cha, việc chờ review, việc Done trong tháng.`,
  inputSchema: { preset: z.enum(Object.keys(PRESET_JQL) as [string, ...string[]]).optional(), jql: z.string().optional(), maxResults: z.number().int().min(1).max(100).optional() },
}, (a) => respond(() => h.searchIssues(jira(), a)));

await server.connect(new StdioServerTransport());
