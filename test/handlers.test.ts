import assert from "node:assert/strict";
import { test } from "node:test";
import { createIssue, getIssue, searchIssues, transitionIssue, updateIssue, validateIssue, whoami } from "../src/handlers.js";
import { ME, REVIEWER, makeFake } from "./fake-jira.js";

const story = {
  type: "Story" as const, project: "XAI", summary: "Mentee có thể đăng ký lịch mentoring online", parent: "XAI-100",
  description: { context: "Cần để mentor sắp lịch", acceptanceCriteria: ["Đặt được lịch", "Có email xác nhận"] },
  assignee: "me", reviewer: "Khanh", startDate: "2026-10-05", plannedEndDate: "2026-10-09", priority: "Medium" as const,
};

test("whoami reports user and field coverage", async () => {
  const { client } = makeFake();
  const r = await whoami(client);
  assert.equal(r.ok, true);
  assert.deepEqual((r.data as any).missingConventionFields, []);
});

test("create: rejects convention violations without calling Jira create", async () => {
  const { client, calls } = makeFake();
  const r = await createIssue(client, { ...story, summary: "Đăng ký lịch", parent: undefined, description: { context: "x" } });
  assert.equal(r.ok, false);
  assert.ok(r.errors!.length >= 3);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("create: rejects project outside the 5 spaces and reviewer == assignee", async () => {
  const { client } = makeFake();
  assert.equal((await createIssue(client, { ...story, project: "FOO" })).ok, false);
  const same = await createIssue(client, { ...story, reviewer: "me" });
  assert.match(same.errors![0]!, /khác Assignee/);
});

test("create: dryRun sends nothing, real create builds the right payload", async () => {
  const { client, calls, issues } = makeFake();
  const dry = await createIssue(client, { ...story, dryRun: true });
  assert.equal(dry.ok, true);
  assert.equal(calls.some((c) => c.method === "POST" && c.path === "/rest/api/3/issue"), false);

  const r = await createIssue(client, story);
  assert.equal(r.ok, true);
  const f = issues.get("XAI-1").fields;
  assert.equal(f.issuetype.name, "Story");
  assert.equal(f.parent.key, "XAI-100");
  assert.equal(f.assignee.accountId, ME.accountId);
  assert.equal(f.customfield_20002.accountId, REVIEWER.accountId);
  assert.equal(f.customfield_10015, "2026-10-05");
  assert.equal(f.customfield_20001, "2026-10-09");
  assert.equal(f.description.type, "doc");
  assert.equal((r.data as any).status, "Backlog");
});

test("create: moveToTodo lands in To Do", async () => {
  const { client, issues } = makeFake();
  const r = await createIssue(client, { ...story, moveToTodo: true });
  assert.equal((r.data as any).status, "To Do");
  assert.equal(issues.get("XAI-1").fields.status.name, "To Do");
});

test("epic needs dates and [Mảng] summary", async () => {
  const { client } = makeFake();
  const bad = await createIssue(client, { type: "Epic", project: "XAI", summary: "Làm website", description: { goal: "g", doneCriteria: ["d"] } });
  assert.equal(bad.ok, false);
  const ok = await createIssue(client, {
    type: "Epic", project: "XAI", summary: "[Website] Ra mắt trang đăng ký khóa học", description: { goal: "g", doneCriteria: ["d"] },
    startDate: "2026-10-05", dueDate: "2026-11-13", assignee: "me",
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test("full lifecycle: To Do -> In Review (evidence+reviewer) -> Done only by reviewer", async () => {
  const { client, issues } = makeFake();
  await createIssue(client, { ...story, reviewer: undefined });

  // In Review without evidence/reviewer is refused before any Jira transition
  const noEv = await transitionIssue(client, { key: "XAI-1", to: "In Review" });
  assert.equal(noEv.ok, false);
  assert.ok(noEv.errors!.some((e) => /Reviewer/.test(e)));

  // set reviewer + evidence and move in one call
  const r = await transitionIssue(client, {
    key: "XAI-1", to: "In Review", reviewer: "Khanh",
    evidence: { result: "Đạt 2/2 AC", proof: ["https://github.com/org/repo/pull/7"] },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const f = issues.get("XAI-1").fields;
  assert.equal(f.status.name, "In Review");
  assert.equal(f.customfield_20003.type, "doc");
  assert.match(JSON.stringify(f.customfield_20003), /Bằng chứng: https:\/\/github\.com\/org\/repo\/pull\/7/);

  // assignee (me) cannot approve own work
  const self = await transitionIssue(client, { key: "XAI-1", to: "Done" });
  assert.equal(self.ok, false);
  assert.match(self.errors![0]!, /Chỉ Reviewer/);
});

test("reviewer account can mark Done", async () => {
  const fake = makeFake({ as: REVIEWER });
  fake.issues.set("XAI-9", {
    id: "9", key: "XAI-9", fields: {
      summary: "Soạn slide", issuetype: { name: "Task" }, status: { name: "In Review" }, assignee: { accountId: ME.accountId, displayName: ME.displayName },
      customfield_20002: { accountId: REVIEWER.accountId, displayName: REVIEWER.displayName },
      customfield_20003: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Kết quả: ok" }] }] },
    },
  });
  const r = await transitionIssue(fake.client, { key: "XAI-9", to: "Done" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fake.issues.get("XAI-9").fields.status.name, "Done");
});

test("Cancelled and Backlog require a comment; comment is posted", async () => {
  const { client, issues } = makeFake();
  await createIssue(client, story);
  assert.equal((await transitionIssue(client, { key: "XAI-1", to: "Cancelled" })).ok, false);
  const r = await transitionIssue(client, { key: "XAI-1", to: "Cancelled", comment: "Không làm nữa" });
  assert.equal(r.ok, true);
  assert.equal(issues.get("XAI-1").comments.length, 1);
});

test("update: evidence with secret is blocked; flag needs comment", async () => {
  const { client } = makeFake();
  await createIssue(client, story);
  const leak = await updateIssue(client, { key: "XAI-1", evidence: { result: "ok", proof: ["password=hunter2hunter2"] } });
  assert.equal(leak.ok, false);
  const noComment = await updateIssue(client, { key: "XAI-1", flagged: true });
  assert.equal(noComment.ok, false);
  const ok = await updateIssue(client, { key: "XAI-1", flagged: true, comment: "Chờ XAI-50 xong" });
  assert.equal(ok.ok, true);
});

test("validate + get + search", async () => {
  const { client } = makeFake();
  await createIssue(client, story);
  const v = await validateIssue(client, "XAI-1");
  assert.equal(v.ok, true, JSON.stringify(v));
  const g = await getIssue(client, "XAI-1");
  assert.equal((g.data as any).reviewer.name, REVIEWER.displayName);
  const bad = await searchIssues(client, {});
  assert.equal(bad.ok, false);
});

test("Jira errors surface with status and detail", async () => {
  const { client } = makeFake();
  await assert.rejects(() => getIssue(client, "XAI-404"), /404.*Issue does not exist/);
});
