---
name: jira-log
description: Log, update, move and review Jira work (Epic, Story, Task, Bug, Sub-task) following the Jira Sprint Convention v1.1 of xbrainvn (spaces SDO, XDO, XAI, AIQT, XDE). Use when the user says "log task", "tạo ticket/epic/story/bug", "báo cáo xong việc", "chuyển sang In Review/Done", "ghi evidence", "việc chờ tôi review", or asks to check a Jira issue against the convention. Requires the jira-mcp server (tools named jira_*).
---

# Jira log theo convention

Dùng tool của MCP server `jira-mcp`. Không gọi REST trực tiếp, không tự bịa field. Trả lời user bằng ngôn ngữ họ dùng; summary/description viết tiếng Việt trừ khi user viết tiếng Anh.

## Bắt đầu
1. Lần đầu trong phiên: gọi `jira_whoami`. Lỗi 401/403 hoặc thiếu env thì dừng, bảo user đặt `JIRA_EMAIL`, `JIRA_API_TOKEN`. Không bao giờ xin hay in token trong chat.
2. Xác định **space** (SDO/XDO/XAI/AIQT/XDE). Không rõ thì hỏi, không đoán.

## Tạo issue
1. Chọn loại: **Story** (người dùng thấy giá trị), **Task** (việc kỹ thuật/vận hành), **Bug** (chạy sai), **Sub-task** (≤ 1 ngày công), **Epic** (mục tiêu 1–3 sprint).
2. Story/Task/Bug bắt buộc có **Parent là Epic**. Tìm bằng `jira_search` (JQL `project = XAI AND type = Epic AND statusCategory != Done`). Không có epic hợp lý thì hỏi user: tạo epic mới hay gắn epic `[Vận hành] Việc chung Q{n}/{yyyy}`. Không kéo Epic vào sprint.
3. Viết summary đúng mẫu:
   - Epic `[{Mảng}] {Kết quả cần đạt}`; Story `{Vai trò} có thể {hành động}`; Task `{Động từ} {đối tượng}`; Bug `[Bug] {Chỗ lỗi}: {hiện tượng}`. ≤ 80 ký tự, mô tả kết quả, không viết tắt nội bộ.
4. Thu đủ thông tin còn thiếu bằng **một** lần hỏi gộp, chỉ hỏi cái không suy ra được: Acceptance criteria, Start date, Planned End Date, Reviewer (khác Assignee). Assignee mặc định `me`. Due date chỉ điền khi có deadline cam kết.
5. Gọi `jira_create_issue` với `dryRun: true`, đưa user xem tóm tắt (key space, loại, summary, parent, ngày, AC), **chờ user đồng ý** rồi mới gọi thật với `dryRun` bỏ trống. Thêm `moveToTodo: true` chỉ khi user muốn đưa vào kế hoạch ngay và đã đủ Assignee + 2 ngày.
6. Báo lại key + URL. Ticket mới nằm ở Backlog; không tự thêm vào sprint.

## Cập nhật tiến độ
- Bắt đầu làm: `jira_transition_issue` tới `In Progress`.
- Đổi ngày hoặc scope: `jira_update_issue` kèm `comment` ghi lý do. Planned End Date vượt Due date thì báo rủi ro cho user, **không tự dời Due date**.
- Bị chặn: `jira_update_issue` với `flagged: true` và `comment` (đang chờ ai/issue nào, bước tiếp theo). Không có status Blocked. Hết vướng thì `flagged: false`.

## Báo xong việc (In Review)
1. Hỏi user (hoặc lấy từ ngữ cảnh): đạt gì so với tiêu chí, link bằng chứng (PR, test, tài liệu, dashboard, ảnh), ai làm phần nào nếu nhiều người.
2. Gọi `jira_transition_issue` với `to: "In Review"`, `reviewer`, `evidence: {result, proof[], contribution?}`. Một lần gọi set field và chuyển status.
3. Evidence không chứa secret/token/key; link phải mở được với Reviewer (không dùng localhost). Tool sẽ chặn nếu vi phạm, sửa rồi gọi lại.

## Done, Cancelled, Backlog
- **Done: chỉ Reviewer được chuyển.** Nếu user là Assignee thì không chuyển Done, nhắc họ nhờ Reviewer. Nếu user là Reviewer: đọc Evidence bằng `jira_get_issue`, kiểm tra chất lượng thật sự (link mở được, khớp tiêu chí), tóm tắt cho user và **xin xác nhận** trước khi `jira_transition_issue` tới `Done`.
- **Cancelled**: chỉ mentor (Administrator), cần `comment` lý do. Xin xác nhận trước.
- **Backlog** (rút khỏi kế hoạch/khôi phục từ Cancelled): cần `comment` lý do.
- Mở lại Done chỉ để sửa trong phạm vi cũ; yêu cầu mới thì tạo issue mới.

## Kiểm tra và báo cáo
- `jira_validate_issue` để soát issue có sẵn theo DoR/DoD, liệt kê lỗi cần sửa.
- `jira_search` preset: `awaiting-my-review`, `my-open`, `my-done-this-month`, `done-this-month`, `missing-reviewer`. Achievement chỉ tính **Done**, không tính Cancelled.

## Quy tắc cứng
- Mọi lỗi tool trả về (`ok: false`, `errors`) là rule của convention: sửa input theo lỗi, không tìm cách lách (đổi loại issue, bỏ field, tạo qua đường khác).
- Warning thì báo user, không chặn.
- Mỗi issue một Assignee, một Component. Story points chỉ 1/2/3/5/8; 13+ phải tách.
- Không tự duyệt: không đổi Assignee sang Reviewer để bàn giao review.
- Chỉ thay đổi issue user nêu hoặc vừa tạo trong phiên. Hành động hàng loạt thì liệt kê và xin xác nhận trước.
