# Office feed: a local status server for coding-agent sessions

*For Isaiah: paste everything from "TASK" down into a new Codex chat opened on this repo
(`C:\Users\Dizzy\Documents\Github\isaiart`). Claude builds the 3D office page separately; it only
needs the JSON this server produces.*

---

## TASK

Build `office/feed.mjs`: a small local HTTP server, Node 22, **no npm dependencies**, that reads the
session logs of the coding agents on this machine and serves a summary of what each session is doing
right now. A browser page (built separately) polls it to animate a 3D office. The server must only
ever **read**; it never writes to the log folders.

### Inputs

1. **Claude Code sessions**: `C:\Users\Dizzy\.claude\projects\<project-folder>\<session-id>.jsonl`.
   One JSON object per line. Keys include `type` (`user` | `assistant` | others), `timestamp` (ISO),
   `sessionId`, `cwd`, `gitBranch`, `slug` (a short memorable name), `isSidechain` (true for helper
   agents; skip those lines), `agentId` (present on helper lines), and `message` with `role` and
   `content`. `content` is a string or an array of blocks: `{"type":"text","text":...}`,
   `{"type":"tool_use","name":"Edit","input":{...}}`, `{"type":"tool_result",...}`.
   Files can be 20 MB+. Never re-read a whole file on every poll: remember each file's byte offset
   and parse only what was appended since.
2. **Codex sessions**: `C:\Users\Dizzy\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl`. One JSON object per
   line with `timestamp`, `ordinal`, `type` and `payload`. The first line is `type: "session_meta"`
   (payload has `session_id`, `cwd`, and the originating instructions/first prompt if present).
   Useful lines: `type: "response_item"` with `payload.type` in `message` (payload.role
   `user`/`assistant`, payload.content blocks), `function_call` / `custom_tool_call` (payload.name,
   payload.arguments or input), `function_call_output` / `custom_tool_call_output`;
   `type: "event_msg"` with `payload.type` `task_complete` (payload.last_agent_message) or
   `task_started`; `type: "turn_context"`.

Look at a few real lines from each before writing the parser; the shapes above are a guide, not a
promise.

### Output

`GET http://127.0.0.1:7331/sessions` returns JSON with CORS header `Access-Control-Allow-Origin: *`:

```json
{
  "updatedAt": "2026-10-06T21:00:00.000Z",
  "sessions": [
    {
      "id": "5c13645f-…",
      "agent": "claude",                 // "claude" | "codex"
      "project": "isaiart",              // last path segment of cwd
      "cwd": "C:\\Users\\Dizzy\\Documents\\Github\\isaiart",
      "branch": "main",                  // or null
      "title": "purring-plotting-hamster",   // Claude: slug; Codex: first 60 chars of the first user prompt
      "status": "working",               // "working" | "waiting" | "idle"
      "activity": "editing villages/js/peek.js",   // short, present tense, no secrets
      "tool": "Edit",                    // last tool name, or null
      "file": "villages/js/peek.js",     // last file touched (relative to cwd), or null
      "lastEventAt": "2026-10-06T20:59:41.000Z",
      "startedAt": "2026-10-06T12:01:03.000Z",
      "turns": 143                       // user turns so far
    }
  ]
}
```

Rules:
- `status`: `working` if the last line is younger than 90 s and the turn is still going (the
  last assistant block is a `tool_use` / `function_call`, or a tool result arrived more recently than
  the last assistant text). `waiting` if the last assistant output is plain text (the turn ended) and
  it's younger than 30 min: the agent is waiting on the person. `idle` otherwise.
- `activity` from the last tool call: `Edit`/`Write`/`apply_patch` → `editing <file>`; `Read` →
  `reading <file>`; `Bash`/`shell`/`PowerShell` → `running: <first 40 chars of the command or its
  description>`; `Grep`/`Glob` → `searching the code`; `Agent` → `delegating to a helper`;
  names starting `mcp__Blender__` → `working in Blender`; `mcp__Claude_Browser__` → `checking the
  preview`; `WebSearch`/`WebFetch` → `looking something up`; anything else → `using <tool>`.
  When `waiting`: `waiting for Isaiah`. When `idle`: `idle`.
- Only sessions with activity in the last 24 hours, newest first, at most 12. Skip Claude sidechain
  lines (`isSidechain: true`) and helper agents entirely.
- Never put message text in the output beyond the 60-character `title`. No prompts, no tool outputs,
  no file contents.
- Also serve `GET /` with a one-paragraph plain-text description and the session count.
- Watch the folders (`fs.watch` with a 1 s debounce, plus a 10 s safety rescan) so new session files
  appear without restarting.
- Start with `node office/feed.mjs` (optional `--port 7331`). Print the URL and the session count on
  start. Handle a missing `.codex` or `.claude` folder gracefully (just fewer sessions).

### Tests

`office/feed.test.mjs`, run with `node --test office/feed.test.mjs`, using small fixture strings (not
the real logs): a Claude session mid-tool-call → `working` with the right `activity`; a Claude session
whose last assistant block is text 5 min ago → `waiting`; a Codex session with `task_complete` 2 h ago →
`idle`; a sidechain line is ignored; the incremental reader picks up appended lines without re-parsing
earlier ones.

### Rules for this job

- Create files only inside `office/`. Don't touch `villages/`, `index.html`, or anything else in the
  repo. Don't commit or push.
- No dependencies. Plain Node 22 (`node:http`, `node:fs`, `node:path`).
- When done: run the tests, start the server once, hit `/sessions`, paste the output (it's fine, it's
  only summaries), stop the server, and list the files you created.
