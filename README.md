# jira-mcp

MCP server (stdio, TypeScript) + Claude skill to log Jira work following **Quy chuẩn tạo Sprint, Epic và Issue trên Jira v1.1** (spaces SDO, XDO, XAI, AIQT, XDE).

The server enforces the written rules *before* calling Jira, so a bad ticket never gets created: name templates, Parent, dates, Acceptance criteria, story points, evidence template and secret scan, and the status-transition rules (To Do / In Review / Done / Cancelled / Backlog).

## Tools

| Tool | Purpose |
|---|---|
| `jira_whoami` | Check auth, show current user, report convention fields missing on the site |
| `jira_create_issue` | Create Epic/Story/Task/Bug/Sub-task from structured input; `dryRun`, `moveToTodo` |
| `jira_update_issue` | Assignee, reviewer, dates, priority, labels, points, evidence, flag (blocked) |
| `jira_transition_issue` | Change status with pre-checks; can set evidence/reviewer in the same call |
| `jira_get_issue` | Read one issue |
| `jira_validate_issue` | Audit an existing issue against DoR/DoD |
| `jira_search` | JQL or presets: `awaiting-my-review`, `my-open`, `my-done-this-month`, `done-this-month`, `missing-reviewer` |

Sprint management (create/start/complete) is out of scope for v0.1.

Custom fields (`Start date`, `Planned End Date`, `Reviewer`, `Evidence`, `Story point estimate`, `Flagged`) are resolved **by name** at runtime, so no field ids are hard-coded. Run `jira_whoami` to see if any is missing on your site.

## Setup

```bash
npm install
npm run build
npm test
```

Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>, then export it in your shell profile (do not put it in a file in the repo):

```bash
export JIRA_EMAIL="you@techxcorp.com"
export JIRA_API_TOKEN="..."
```

### Claude Code
This repo ships `.mcp.json` (reads the env vars above) and the skill in `.claude/skills/jira-log/`. Open Claude Code in this directory and approve the `jira` server. To use it from any project:

```bash
claude mcp add jira --scope user -e JIRA_EMAIL="$JIRA_EMAIL" -e JIRA_API_TOKEN="$JIRA_API_TOKEN" -- node "$(pwd)/dist/index.js"
cp -R .claude/skills/jira-log ~/.claude/skills/
```

### Claude Desktop
Add to `claude_desktop_config.json`:

```json
{ "mcpServers": { "jira": { "command": "node", "args": ["/absolute/path/to/jira-mcp/dist/index.js"],
  "env": { "JIRA_EMAIL": "you@techxcorp.com", "JIRA_API_TOKEN": "..." } } } }
```

## Permissions
The server acts as the token owner, so Jira's own rules still apply: only the Reviewer can move to Done, only an Administrator can Cancel. Client-side checks mirror these to give clear errors early; Jira remains the authority.

## Develop
`npm run dev` runs from source. Tests use an in-memory fake Jira (`test/fake-jira.ts`); no network or credentials needed.
