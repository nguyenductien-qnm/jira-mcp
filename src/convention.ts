// Rules from "Quy chuẩn tạo Sprint, Epic và Issue trên Jira" v1.1 (01/10/2026). Pure functions, no I/O.
import { bullets, checklist, doc, label, ordered, para, text, type Adf, type AdfNode } from "./adf.js";

export const PROJECTS = ["SDO", "XDO", "XAI", "AIQT", "XDE"] as const;
export const ISSUE_TYPES = ["Epic", "Story", "Task", "Bug", "Sub-task"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export const STATUSES = ["Backlog", "To Do", "In Progress", "In Review", "Done", "Cancelled"] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ["Highest", "High", "Medium", "Low"] as const;
export const KNOWN_LABELS = ["mentee-task", "mentor-task", "training", "hotfix", "retro-action"] as const;
export const STORY_POINTS = [1, 2, 3, 5, 8] as const;

export type Findings = { errors: string[]; warnings: string[] };
export const empty = (): Findings => ({ errors: [], warnings: [] });

export const SPRINT_NAME = /^[A-Z]{3,5} Sprint \d{2} \| \d{2}\/\d{2}–\d{2}\/\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(s: string): Date | null {
  if (!ISO_DATE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}
const dayDiff = (a: string, b: string) => Math.round((parseDate(b)!.getTime() - parseDate(a)!.getTime()) / 86_400_000);

export function validateSummary(type: IssueType, summary: string): Findings {
  const f = empty();
  const s = summary.trim();
  if (!s) f.errors.push("Summary trống.");
  if (s.length > 120) f.errors.push(`Summary dài ${s.length} ký tự, tối đa khoảng 80.`);
  else if (s.length > 80) f.warnings.push(`Summary dài ${s.length} ký tự, nên ≤ 80.`);
  if (/^(epic|sprint|task|story|bug|việc)\s*\d*$/i.test(s) || /^việc tháng/i.test(s))
    f.errors.push("Summary quá chung chung, phải mô tả kết quả/đầu việc rõ ràng.");
  if (type === "Epic" && !/^\[[^\]\n]+\]\s+\S/.test(s))
    f.errors.push("Epic phải theo mẫu `[{Mảng}] {Kết quả cần đạt}`, ví dụ `[Website] Ra mắt trang đăng ký khóa học`.");
  if (type === "Bug" && !/^\[Bug\]\s+[^:\n]+:\s+\S/.test(s))
    f.errors.push("Bug phải theo mẫu `[Bug] {Chỗ lỗi}: {hiện tượng}`.");
  if (type === "Story" && !/\scó thể\s/i.test(s))
    f.errors.push("Story phải theo mẫu `{Vai trò} có thể {hành động}`.");
  return f;
}

export function validateLabels(labels: string[]): Findings {
  const f = empty();
  for (const l of labels) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(l)) f.errors.push(`Label "${l}" phải chữ thường, không dấu, nối bằng gạch ngang.`);
    else if (!(KNOWN_LABELS as readonly string[]).includes(l)) f.warnings.push(`Label "${l}" không nằm trong danh sách chuẩn (${KNOWN_LABELS.join(", ")}).`);
  }
  return f;
}

export function validateStoryPoints(n: number): Findings {
  const f = empty();
  if (!(STORY_POINTS as readonly number[]).includes(n))
    f.errors.push(n >= 13 ? `Story points ${n}: từ 13 trở lên phải tách nhỏ trước khi vào sprint.` : `Story points phải thuộc ${STORY_POINTS.join(", ")}.`);
  return f;
}

export type Dates = { startDate?: string; plannedEndDate?: string; dueDate?: string };

export function validateDates(d: Dates): Findings {
  const f = empty();
  for (const k of ["startDate", "plannedEndDate", "dueDate"] as const) {
    const v = d[k];
    if (v && !parseDate(v)) f.errors.push(`${k} "${v}" không phải ngày hợp lệ YYYY-MM-DD.`);
  }
  if (f.errors.length) return f;
  if (d.startDate && d.plannedEndDate && d.startDate > d.plannedEndDate) f.errors.push("Start date phải ≤ Planned End Date.");
  if (d.plannedEndDate && d.dueDate && d.plannedEndDate > d.dueDate)
    f.warnings.push("Planned End Date vượt Due date: báo rủi ro cho mentor, không tự dời Due date.");
  return f;
}

export type DescriptionInput = {
  context?: string;
  requirements?: string[];
  acceptanceCriteria?: string[];
  steps?: string[];
  actual?: string;
  expected?: string;
  environment?: string;
  goal?: string;
  doneCriteria?: string[];
  inScope?: string[];
  outOfScope?: string[];
  links?: string[];
};

export function validateDescription(type: IssueType, d: DescriptionInput): Findings {
  const f = empty();
  const need = (ok: boolean, msg: string) => ok || f.errors.push(msg);
  const has = (a?: string[]) => !!a && a.some((x) => x.trim());
  if (type === "Story" || type === "Task") {
    need(!!d.context?.trim(), "Description thiếu `context` (Bối cảnh).");
    need(has(d.acceptanceCriteria), "Description thiếu `acceptanceCriteria` (ít nhất 1).");
    if (!has(d.requirements)) f.warnings.push("Nên có `requirements` (Yêu cầu).");
  } else if (type === "Bug") {
    need(has(d.steps), "Bug thiếu `steps` (các bước tái hiện).");
    need(!!d.actual?.trim(), "Bug thiếu `actual` (kết quả thực tế).");
    need(!!d.expected?.trim(), "Bug thiếu `expected` (kết quả mong đợi).");
    if (!d.environment?.trim()) f.warnings.push("Bug nên có `environment` (trình duyệt, thiết bị, link, ảnh).");
  } else if (type === "Epic") {
    need(!!d.goal?.trim(), "Epic thiếu `goal` (Mục tiêu).");
    need(has(d.doneCriteria), "Epic thiếu `doneCriteria` (Tiêu chí hoàn thành, đo được).");
    if (!has(d.inScope) || !has(d.outOfScope)) f.warnings.push("Epic nên khai báo cả `inScope` và `outOfScope`.");
  } else {
    need(!!d.context?.trim(), "Sub-task thiếu `context` mô tả phần việc.");
  }
  return f;
}

const section = (title: string, body: AdfNode[]): AdfNode[] => [label(title), ...body];
const clean = (a?: string[]) => (a ?? []).map((x) => x.trim()).filter(Boolean);

export function buildDescription(type: IssueType, d: DescriptionInput): Adf {
  const out: AdfNode[] = [];
  if (type === "Epic") {
    out.push(...section("Mục tiêu:", [para(text(d.goal?.trim() ?? ""))]));
    out.push(...section("Tiêu chí hoàn thành:", [checklist(clean(d.doneCriteria))]));
    const inS = clean(d.inScope), outS = clean(d.outOfScope);
    if (inS.length || outS.length) {
      out.push(label("Phạm vi:"));
      if (inS.length) out.push(para(text("Trong phạm vi:", true)), bullets(inS));
      if (outS.length) out.push(para(text("Ngoài phạm vi:", true)), bullets(outS));
    }
    if (clean(d.links).length) out.push(...section("Tài liệu liên quan:", [bullets(clean(d.links))]));
  } else if (type === "Bug") {
    out.push(...section("Các bước tái hiện:", [ordered(clean(d.steps))]));
    out.push(...section("Kết quả thực tế:", [para(text(d.actual?.trim() ?? ""))]));
    out.push(...section("Kết quả mong đợi:", [para(text(d.expected?.trim() ?? ""))]));
    if (d.environment?.trim()) out.push(...section("Môi trường / ảnh chụp:", [para(text(d.environment.trim()))]));
  } else if (type === "Sub-task") {
    out.push(para(text(d.context?.trim() ?? "")));
    if (clean(d.acceptanceCriteria).length) out.push(...section("Acceptance criteria:", [checklist(clean(d.acceptanceCriteria))]));
  } else {
    out.push(...section("Bối cảnh:", [para(text(d.context?.trim() ?? ""))]));
    if (clean(d.requirements).length) out.push(...section("Yêu cầu:", [bullets(clean(d.requirements))]));
    out.push(...section("Acceptance criteria:", [checklist(clean(d.acceptanceCriteria))]));
  }
  return doc(...out);
}

export type EvidenceInput = { result: string; proof: string[]; contribution?: string };

const SECRET_PATTERNS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(password|passwd|secret|api[_-]?key|token)\s*[=:]\s*\S{6,}/i, "credential dạng key=value"],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, "Bearer token"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bATATT[A-Za-z0-9_=-]{20,}/, "Atlassian API token"],
];

export function validateEvidence(e: EvidenceInput): Findings {
  const f = empty();
  if (!e.result.trim()) f.errors.push("Evidence thiếu `result` (Kết quả so với tiêu chí hoàn thành).");
  if (!e.proof.some((p) => p.trim())) f.errors.push("Evidence thiếu `proof` (link PR/test/tài liệu/dashboard/ảnh).");
  const all = [e.result, ...e.proof, e.contribution ?? ""].join("\n");
  for (const [re, name] of SECRET_PATTERNS) if (re.test(all)) f.errors.push(`Evidence có vẻ chứa ${name}, không đưa secret vào Evidence.`);
  for (const p of e.proof) if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(p.trim())) f.warnings.push(`Link "${p}" là link nội bộ, Reviewer có thể không mở được.`);
  return f;
}

export function formatEvidence(e: EvidenceInput): string {
  const lines = [`Kết quả: ${e.result.trim()}`, `Bằng chứng: ${e.proof.map((p) => p.trim()).filter(Boolean).join(" ; ")}`];
  if (e.contribution?.trim()) lines.push(`Đóng góp: ${e.contribution.trim()}`);
  return lines.join("\n");
}

export type IssueState = {
  type?: string;
  summary: string;
  status: string;
  assigneeId?: string;
  reviewerId?: string;
  parentKey?: string;
  priority?: string;
  startDate?: string;
  plannedEndDate?: string;
  description?: string;
  evidence?: string;
  currentUserId?: string;
};

/** Pre-check a status change against the Jira-enforced validators and the written rules. */
export function checkTransition(to: Status, s: IssueState, opts: { commentProvided: boolean }): Findings {
  const f = empty();
  if (to === "To Do") {
    if (!s.assigneeId) f.errors.push("To Do cần Assignee.");
    if (!s.startDate) f.errors.push("To Do cần Start date.");
    if (!s.plannedEndDate) f.errors.push("To Do cần Planned End Date.");
    if (!s.parentKey && s.type !== "Epic") f.warnings.push("DoR: chưa có Parent (Epic).");
    if (!s.priority) f.warnings.push("DoR: chưa có Priority.");
    if (!s.description?.trim()) f.warnings.push("DoR: Description trống, cần phạm vi và Acceptance criteria.");
    else if (!/acceptance criteria/i.test(s.description)) f.warnings.push("DoR: Description chưa thấy Acceptance criteria.");
  }
  if (to === "In Review") {
    if (!s.reviewerId) f.errors.push("In Review cần Reviewer.");
    else if (s.reviewerId === s.assigneeId) f.errors.push("Reviewer phải khác Assignee.");
    if (!s.evidence?.trim()) f.errors.push("In Review cần Evidence.");
  }
  if (to === "Done") {
    if (!s.evidence?.trim()) f.errors.push("Done cần Evidence.");
    if (!s.reviewerId) f.errors.push("Done cần Reviewer đã xác nhận.");
    else if (s.currentUserId && s.currentUserId !== s.reviewerId) f.errors.push("Chỉ Reviewer mới được chuyển sang Done (không tự duyệt).");
    if (s.status !== "In Review") f.warnings.push(`Issue đang ở ${s.status}, thường phải qua In Review trước khi Done.`);
  }
  if (to === "Cancelled") {
    if (!opts.commentProvided) f.errors.push("Cancelled cần comment lý do hủy.");
    f.warnings.push("Chỉ Administrator (mentor) được chuyển sang Cancelled; Jira sẽ từ chối nếu bạn không phải.");
  }
  if (to === "Backlog" && !opts.commentProvided) f.errors.push("Chuyển về Backlog cần comment lý do.");
  return f;
}

export const PRESET_JQL: Record<string, string> = {
  "my-open": "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC",
  "awaiting-my-review": `project in (${PROJECTS.join(", ")}) AND status = "In Review" AND "Reviewer[People]" = currentUser()`,
  "done-this-month": `project in (${PROJECTS.join(", ")}) AND status = Done AND resolved >= startOfMonth() ORDER BY assignee, resolved`,
  "my-done-this-month": `project in (${PROJECTS.join(", ")}) AND status = Done AND assignee = currentUser() AND resolved >= startOfMonth() ORDER BY resolved`,
  "missing-reviewer": `project in (${PROJECTS.join(", ")}) AND statusCategory != Done AND assignee = currentUser() AND Reviewer is EMPTY`,
};

export const merge = (...fs: Findings[]): Findings => ({ errors: fs.flatMap((x) => x.errors), warnings: fs.flatMap((x) => x.warnings) });
