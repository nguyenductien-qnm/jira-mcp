// Tool logic, kept separate from MCP wiring so it can be tested against a fake Jira.
import { textToAdf } from "./adf.js";
import {
  PRESET_JQL, PROJECTS, buildDescription, checkTransition, formatEvidence, merge, validateDates, validateDescription,
  validateEvidence, validateLabels, validateStoryPoints, validateSummary,
  type DescriptionInput, type EvidenceInput, type Findings, type IssueType, type Status,
} from "./convention.js";
import { JiraClient, toView, viewFields, type IssueView } from "./jira.js";

export type Result = { ok: boolean; data?: unknown; errors?: string[]; warnings?: string[] };
const fail = (f: Findings): Result => ({ ok: false, errors: f.errors, warnings: f.warnings });

async function loadView(c: JiraClient, key: string): Promise<IssueView> {
  const { ids, map } = await viewFields(c);
  return toView(c, await c.getIssue(key, ids), map);
}

export type CreateInput = {
  type: IssueType; project?: string; summary: string; description: DescriptionInput; parent?: string;
  assignee?: string; reviewer?: string; startDate?: string; plannedEndDate?: string; dueDate?: string;
  priority?: string; component?: string; labels?: string[]; storyPoints?: number; moveToTodo?: boolean; dryRun?: boolean;
};

export async function createIssue(c: JiraClient, i: CreateInput): Promise<Result> {
  const project = (i.project ?? c.cfg.defaultProject)?.toUpperCase();
  const f = merge(
    validateSummary(i.type, i.summary),
    validateDescription(i.type, i.description),
    validateDates(i),
    validateLabels(i.labels ?? []),
    i.storyPoints !== undefined ? validateStoryPoints(i.storyPoints) : { errors: [], warnings: [] },
  );
  if (!project) f.errors.push("Thiếu `project` (và chưa đặt JIRA_DEFAULT_PROJECT).");
  else if (!(PROJECTS as readonly string[]).includes(project)) f.errors.push(`Project "${project}" không thuộc 5 space chuẩn: ${PROJECTS.join(", ")}.`);
  if (i.type !== "Epic" && !i.parent) f.errors.push(i.type === "Sub-task" ? "Sub-task phải có `parent` là issue cha." : "Story/Task/Bug phải có `parent` là Epic. Việc lẻ gắn epic `[Vận hành] Việc chung Q{n}/{yyyy}`.");
  if (i.type === "Epic") {
    if (!i.startDate || !i.dueDate) f.errors.push("Epic phải có `startDate` và `dueDate`.");
    else if (!f.errors.length && (new Date(i.dueDate).getTime() - new Date(i.startDate).getTime()) / 86_400_000 > 42)
      f.warnings.push("Epic dài hơn 3 sprint (~42 ngày), nên tách.");
  }
  if (i.moveToTodo) {
    if (!i.assignee) f.errors.push("moveToTodo cần `assignee`.");
    if (!i.startDate || !i.plannedEndDate) f.errors.push("moveToTodo cần `startDate` và `plannedEndDate`.");
  }
  if (!i.priority) f.warnings.push("Chưa có `priority`, mặc định Medium của Jira.");
  if (!i.assignee) f.warnings.push("Chưa có `assignee`.");
  if (f.errors.length) return fail(f);

  const fields: Record<string, unknown> = {
    project: { key: project }, issuetype: { name: i.type }, summary: i.summary.trim(),
    description: buildDescription(i.type, i.description),
  };
  if (i.parent) fields.parent = { key: i.parent };
  if (i.priority) fields.priority = { name: i.priority };
  if (i.component) fields.components = [{ name: i.component }];
  if (i.labels?.length) fields.labels = i.labels;
  if (i.dueDate) fields.duedate = i.dueDate;
  const who: Record<string, string> = {};
  if (i.assignee) { const u = await c.resolveUser(i.assignee); fields.assignee = { accountId: u.accountId }; who.assignee = u.displayName; }
  if (i.reviewer) {
    const u = await c.resolveUser(i.reviewer);
    if (i.assignee && u.accountId === (fields.assignee as any).accountId) return fail({ errors: ["Reviewer phải khác Assignee."], warnings: [] });
    const fd = (await c.field("reviewer", true))!;
    fields[fd.id] = await c.userFieldValue(fd, u.accountId);
    who.reviewer = u.displayName;
  }
  if (i.startDate) fields[(await c.field("startDate", true))!.id] = i.startDate;
  if (i.plannedEndDate) fields[(await c.field("plannedEndDate", true))!.id] = i.plannedEndDate;
  if (i.storyPoints !== undefined) fields[(await c.field("storyPoints", true))!.id] = i.storyPoints;

  if (i.dryRun) return { ok: true, warnings: f.warnings, data: { dryRun: true, wouldCreate: { ...fields, ...who } } };
  const created = await c.createIssue(fields);
  let status = "Backlog";
  const notes = [...f.warnings];
  if (i.moveToTodo) {
    try { await moveTo(c, created.key, "To Do"); status = "To Do"; }
    catch (e) { notes.push(`Đã tạo nhưng chuyển To Do thất bại: ${(e as Error).message}`); }
  }
  return { ok: true, warnings: notes, data: { key: created.key, url: c.url(created.key), status, ...who } };
}

async function moveTo(c: JiraClient, key: string, to: string) {
  const t = (await c.transitions(key)).find((x) => x.to.name.toLowerCase() === to.toLowerCase());
  if (!t) throw new Error(`Không có transition tới "${to}" từ trạng thái hiện tại.`);
  await c.transition(key, t.id);
}

export type UpdateInput = {
  key: string; summary?: string; assignee?: string; reviewer?: string; startDate?: string; plannedEndDate?: string;
  dueDate?: string; priority?: string; labels?: string[]; storyPoints?: number; evidence?: EvidenceInput;
  flagged?: boolean; comment?: string;
};

/** Builds the Jira `fields` payload for an update; shared by update and transition. */
async function buildUpdate(c: JiraClient, cur: IssueView, i: Omit<UpdateInput, "key" | "comment" | "flagged">): Promise<{ fields: Record<string, unknown>; f: Findings; assigneeId?: string; reviewerId?: string }> {
  const f = merge(
    i.summary ? validateSummary((cur.type as IssueType) ?? "Task", i.summary) : { errors: [], warnings: [] },
    validateDates({ startDate: i.startDate ?? cur.startDate, plannedEndDate: i.plannedEndDate ?? cur.plannedEndDate, dueDate: i.dueDate ?? cur.dueDate }),
    i.labels ? validateLabels(i.labels) : { errors: [], warnings: [] },
    i.storyPoints !== undefined ? validateStoryPoints(i.storyPoints) : { errors: [], warnings: [] },
    i.evidence ? validateEvidence(i.evidence) : { errors: [], warnings: [] },
  );
  const fields: Record<string, unknown> = {};
  if (i.summary) fields.summary = i.summary.trim();
  if (i.priority) fields.priority = { name: i.priority };
  if (i.labels) fields.labels = i.labels;
  if (i.dueDate) fields.duedate = i.dueDate;
  let assigneeId = cur.assignee?.id;
  if (i.assignee) { const u = await c.resolveUser(i.assignee); fields.assignee = { accountId: u.accountId }; assigneeId = u.accountId; }
  let reviewerId = cur.reviewer?.id;
  if (i.reviewer) {
    const u = await c.resolveUser(i.reviewer);
    if (u.accountId === assigneeId) f.errors.push("Reviewer phải khác Assignee.");
    const fd = (await c.field("reviewer", true))!;
    fields[fd.id] = await c.userFieldValue(fd, u.accountId);
    reviewerId = u.accountId;
  } else if (i.assignee && cur.reviewer && cur.reviewer.id === assigneeId) f.errors.push("Assignee mới trùng Reviewer hiện tại, đổi Reviewer trước.");
  if (i.startDate) fields[(await c.field("startDate", true))!.id] = i.startDate;
  if (i.plannedEndDate) fields[(await c.field("plannedEndDate", true))!.id] = i.plannedEndDate;
  if (i.storyPoints !== undefined) fields[(await c.field("storyPoints", true))!.id] = i.storyPoints;
  if (i.evidence) {
    const fd = (await c.field("evidence", true))!;
    fields[fd.id] = c.textFieldValue(fd, formatEvidence(i.evidence), textToAdf);
  }
  return { fields, f, assigneeId, reviewerId };
}

export async function updateIssue(c: JiraClient, i: UpdateInput): Promise<Result> {
  const cur = await loadView(c, i.key);
  const { key: _k, comment, flagged, ...rest } = i;
  const { fields, f } = await buildUpdate(c, cur, rest);
  if (flagged !== undefined) {
    if (!comment?.trim()) f.errors.push("Đổi flag cần `comment` lý do: đang chờ ai/issue nào và bước tiếp theo.");
    const fd = (await c.field("flagged", true))!;
    fields[fd.id] = flagged ? [{ value: "Impediment" }] : [];
  }
  if (f.errors.length) return fail(f);
  if (!Object.keys(fields).length && !comment) return fail({ errors: ["Không có gì để cập nhật."], warnings: [] });
  if (Object.keys(fields).length) await c.updateIssue(i.key, fields);
  if (comment?.trim()) await c.addComment(i.key, textToAdf(comment));
  return { ok: true, warnings: f.warnings, data: { key: i.key, url: c.url(i.key), updated: Object.keys(fields), commented: !!comment?.trim() } };
}

export type TransitionInput = UpdateInput & { to: Status };

export async function transitionIssue(c: JiraClient, i: TransitionInput): Promise<Result> {
  const cur = await loadView(c, i.key);
  const me = await c.myself();
  const { key: _k, to, comment, flagged: _fl, ...rest } = i;
  const { fields, f, assigneeId: newAssignee, reviewerId: newReviewer } = await buildUpdate(c, cur, rest);

  // Effective state after the optional field update, so "evidence + move to In Review" works in one call.
  const evidenceText = i.evidence ? formatEvidence(i.evidence) : cur.evidence;
  const check = checkTransition(to, {
    type: cur.type, summary: i.summary ?? cur.summary, status: cur.status,
    assigneeId: newAssignee, reviewerId: newReviewer, parentKey: cur.parent,
    priority: i.priority ?? cur.priority, startDate: i.startDate ?? cur.startDate,
    plannedEndDate: i.plannedEndDate ?? cur.plannedEndDate, description: cur.description,
    evidence: evidenceText, currentUserId: me.accountId,
  }, { commentProvided: !!comment?.trim() });
  const all = merge(f, check);
  if (all.errors.length) return fail(all);

  const t = (await c.transitions(i.key)).find((x) => x.to.name.toLowerCase() === to.toLowerCase());
  if (!t) return fail({ errors: [`Không có transition tới "${to}" từ "${cur.status}". Có: ${(await c.transitions(i.key)).map((x) => x.to.name).join(", ")}`], warnings: all.warnings });

  if (Object.keys(fields).length) await c.updateIssue(i.key, fields);
  if (comment?.trim()) await c.addComment(i.key, textToAdf(comment));
  await c.transition(i.key, t.id);
  return { ok: true, warnings: all.warnings, data: { key: i.key, url: c.url(i.key), from: cur.status, to } };
}

export async function getIssue(c: JiraClient, key: string): Promise<Result> {
  return { ok: true, data: await loadView(c, key) };
}

export async function validateIssue(c: JiraClient, key: string): Promise<Result> {
  const v = await loadView(c, key);
  const f = merge(validateSummary((v.type as IssueType) ?? "Task", v.summary), validateDates(v));
  if (!v.assignee) f.errors.push("Thiếu Assignee.");
  if (!v.startDate) f.errors.push("Thiếu Start date.");
  if (!v.plannedEndDate) f.errors.push("Thiếu Planned End Date.");
  if (!v.parent && v.type !== "Epic") f.errors.push("Thiếu Parent (Epic).");
  if (!v.priority) f.warnings.push("Thiếu Priority.");
  if (!/acceptance criteria|tiêu chí hoàn thành/i.test(v.description ?? "")) f.errors.push("Description thiếu Acceptance criteria / Tiêu chí hoàn thành.");
  if (v.reviewer && v.assignee && v.reviewer.id === v.assignee.id) f.errors.push("Reviewer trùng Assignee.");
  if (["In Review", "Done"].includes(v.status)) {
    if (!v.reviewer) f.errors.push(`${v.status} nhưng thiếu Reviewer.`);
    if (!v.evidence?.trim()) f.errors.push(`${v.status} nhưng thiếu Evidence.`);
  }
  if (v.components.length > 1) f.warnings.push("Mỗi issue chỉ nên có đúng 1 component.");
  f.warnings.push(...validateLabels(v.labels).warnings, ...validateLabels(v.labels).errors);
  return { ok: f.errors.length === 0, errors: f.errors, warnings: f.warnings, data: { key: v.key, status: v.status, type: v.type } };
}

export async function searchIssues(c: JiraClient, i: { preset?: string; jql?: string; maxResults?: number }): Promise<Result> {
  const jql = i.jql ?? (i.preset ? PRESET_JQL[i.preset] : undefined);
  if (!jql) return fail({ errors: [`Cần \`jql\` hoặc \`preset\` (${Object.keys(PRESET_JQL).join(", ")}).`], warnings: [] });
  const { ids, map } = await viewFields(c);
  const r = await c.search(jql, ids, Math.min(i.maxResults ?? 25, 100));
  return { ok: true, data: { jql, count: r.issues.length, issues: r.issues.map((x) => compact(toView(c, x, map))) } };
}

const compact = (v: IssueView) => ({
  key: v.key, url: v.url, type: v.type, summary: v.summary, status: v.status, priority: v.priority,
  assignee: v.assignee?.name, reviewer: v.reviewer?.name, parent: v.parent, plannedEnd: v.plannedEndDate, due: v.dueDate,
  flagged: v.flagged || undefined,
});

export async function whoami(c: JiraClient): Promise<Result> {
  const me = await c.myself();
  const missing = [];
  for (const k of ["startDate", "plannedEndDate", "reviewer", "evidence"] as const) if (!(await c.field(k))) missing.push(k);
  return { ok: true, data: { accountId: me.accountId, name: me.displayName, site: c.cfg.baseUrl, missingConventionFields: missing }, warnings: missing.length ? [`Site thiếu field theo convention: ${missing.join(", ")}`] : [] };
}

