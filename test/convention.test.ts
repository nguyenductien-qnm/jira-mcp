import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPRINT_NAME, checkTransition, formatEvidence, validateDates, validateEvidence, validateLabels, validateStoryPoints, validateSummary,
} from "../src/convention.js";
import { adfToText } from "../src/adf.js";
import { buildDescription } from "../src/convention.js";

test("sprint name pattern", () => {
  assert.match("XAI Sprint 03 | 05/10–16/10", SPRINT_NAME);
  assert.doesNotMatch("Sprint mới", SPRINT_NAME);
  assert.doesNotMatch("XAI Board Sprint 1", SPRINT_NAME);
});

test("summary templates per type", () => {
  assert.equal(validateSummary("Epic", "[Website] Ra mắt trang đăng ký khóa học").errors.length, 0);
  assert.ok(validateSummary("Epic", "Làm website").errors.length);
  assert.ok(validateSummary("Epic", "Epic 1").errors.length);
  assert.equal(validateSummary("Bug", "[Bug] Form đăng ký: không gửi được email xác nhận").errors.length, 0);
  assert.ok(validateSummary("Bug", "Form lỗi").errors.length);
  assert.equal(validateSummary("Story", "Mentee có thể đăng ký lịch mentoring online").errors.length, 0);
  assert.ok(validateSummary("Story", "Đăng ký lịch").errors.length);
  assert.equal(validateSummary("Task", "Soạn slide buổi training Git cơ bản").errors.length, 0);
  assert.ok(validateSummary("Task", "x".repeat(130)).errors.length);
  assert.equal(validateSummary("Task", "x".repeat(90)).warnings.length, 1);
});

test("story points: fibonacci, 13+ rejected", () => {
  for (const n of [1, 2, 3, 5, 8]) assert.equal(validateStoryPoints(n).errors.length, 0);
  assert.match(validateStoryPoints(13).errors[0]!, /tách/);
  assert.ok(validateStoryPoints(4).errors.length);
});

test("dates", () => {
  assert.ok(validateDates({ startDate: "2026-10-10", plannedEndDate: "2026-10-05" }).errors.length);
  assert.ok(validateDates({ startDate: "2026-02-30" }).errors.length);
  const w = validateDates({ plannedEndDate: "2026-10-20", dueDate: "2026-10-15" });
  assert.equal(w.errors.length, 0);
  assert.equal(w.warnings.length, 1);
});

test("labels", () => {
  assert.equal(validateLabels(["mentee-task"]).errors.length, 0);
  assert.ok(validateLabels(["Mentee Task"]).errors.length);
  assert.equal(validateLabels(["custom-thing"]).warnings.length, 1);
});

test("evidence: template, secrets", () => {
  const ok = { result: "Đạt đủ AC", proof: ["https://github.com/org/repo/pull/1"] };
  assert.equal(validateEvidence(ok).errors.length, 0);
  assert.match(formatEvidence({ ...ok, contribution: "Duc: code" }), /^Kết quả: .*\nBằng chứng: .*\nĐóng góp: /);
  assert.ok(validateEvidence({ result: "", proof: [] }).errors.length >= 2);
  assert.ok(validateEvidence({ ...ok, proof: ["token=abcdef123456 in log"] }).errors.length);
  assert.ok(validateEvidence({ ...ok, proof: ["-----BEGIN RSA PRIVATE KEY-----"] }).errors.length);
  assert.equal(validateEvidence({ ...ok, proof: ["http://localhost:3000/x"] }).warnings.length, 1);
});

test("transition rules", () => {
  const base = { summary: "s", status: "In Progress", assigneeId: "a", reviewerId: "r", evidence: "e", startDate: "2026-10-05", plannedEndDate: "2026-10-09" };
  assert.ok(checkTransition("To Do", { ...base, assigneeId: undefined }, { commentProvided: false }).errors.length);
  assert.equal(checkTransition("To Do", base, { commentProvided: false }).errors.length, 0);
  assert.ok(checkTransition("In Review", { ...base, reviewerId: "a" }, { commentProvided: false }).errors.length, "reviewer == assignee");
  assert.ok(checkTransition("In Review", { ...base, evidence: "" }, { commentProvided: false }).errors.length);
  assert.ok(checkTransition("Done", { ...base, status: "In Review", currentUserId: "a" }, { commentProvided: false }).errors.length, "only reviewer");
  assert.equal(checkTransition("Done", { ...base, status: "In Review", currentUserId: "r" }, { commentProvided: false }).errors.length, 0);
  assert.ok(checkTransition("Cancelled", base, { commentProvided: false }).errors.length);
  assert.ok(checkTransition("Backlog", base, { commentProvided: false }).errors.length);
  assert.equal(checkTransition("Backlog", base, { commentProvided: true }).errors.length, 0);
});

test("description builds ADF with AC checklist and round-trips to text", () => {
  const d = buildDescription("Story", { context: "Vì sao", requirements: ["A"], acceptanceCriteria: ["Đạt 1", "Đạt 2"] });
  const t = adfToText(d);
  assert.match(t, /Bối cảnh:\nVì sao/);
  assert.match(t, /Acceptance criteria:\n- \[ \] Đạt 1\n- \[ \] Đạt 2/);
});
