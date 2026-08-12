# LINE Reply Flex Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every incoming LINE text event receive a valid Flex Reply, including `ยืมอุปกรณ์`, while retaining existing Push notifications.

**Architecture:** Keep command routing inside `doPost`. Replace unsupported gradient `background` objects in Flex box components with LINE-supported solid `backgroundColor` fields, then make `replyLineFlex_` return a structured HTTP result so a failed LINE validation is visible in execution logs. A small Node static checker will reject unsupported Flex keys in the webhook source before deployment.

**Tech Stack:** Google Apps Script, LINE Messaging API Flex Messages, Node.js built-in `fs` and `assert`.

## Global Constraints

- Every incoming LINE text event sends exactly one Reply API request using its one-time `replyToken`.
- System-initiated notifications continue to use the Push API.
- Flex blocks use LINE-supported properties; use `backgroundColor`, not a `background` gradient object.
- Do not send a real LINE test notification automatically.

---

### Task 1: Add static payload regression coverage

**Files:**
- Create: `tests/line-flex-schema-check.js`
- Modify: `package.json` (only if absent, add a `test:line-flex` script)

**Interfaces:**
- Consumes: `รหัส.js` as UTF-8 source text.
- Produces: exit code `0` only when webhook Flex blocks avoid unsupported gradient `background` objects and `replyLineFlex_` exists.

- [ ] **Step 1: Write the failing test**

Create `tests/line-flex-schema-check.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('รหัส.js', 'utf8');
assert.match(source, /function replyLineFlex_\(/, 'Reply Flex helper must exist');
assert.doesNotMatch(
  source,
  /background:\s*\{\s*type:\s*["']linearGradient["']/,
  'LINE Flex does not accept a background gradient object; use backgroundColor'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/line-flex-schema-check.js`

Expected: `AssertionError` identifying `linearGradient` in `รหัส.js`.

- [ ] **Step 3: Add a package script if package.json exists**

If `package.json` exists, add:

```json
"test:line-flex": "node tests/line-flex-schema-check.js"
```

Otherwise retain the direct Node command as the canonical test command; do not introduce package management just for this check.

- [ ] **Step 4: Commit**

```bash
git add tests/line-flex-schema-check.js package.json
git commit -m "test: guard LINE Reply Flex schema"
```

### Task 2: Correct invalid webhook Flex styles and expose Reply API errors

**Files:**
- Modify: `รหัส.js:219-981`
- Modify: `รหัส.js:2602-2629`

**Interfaces:**
- Consumes: `replyLineFlex_(replyToken, altText, flexContent)`.
- Produces: `{ success: boolean, status: number, body: string }` from `replyLineFlex_`.

- [ ] **Step 1: Replace invalid gradient background fields**

In every webhook Flex card, replace this unsupported box property:

```js
background: {
  type: 'linearGradient',
  angle: '135deg',
  startColor: '#4f46e5',
  endColor: '#6366f1'
},
```

with a solid supported color, preserving the card's primary color:

```js
backgroundColor: '#4f46e5',
```

Apply the equivalent substitution for every gradient header in the webhook command responses. Do not alter message routing: `ยืมอุปกรณ์` must continue to route through the borrowing branch at `msgLower.indexOf('ยืม') !== -1`.

- [ ] **Step 2: Return a diagnosable result from the Reply helper**

Update the successful path in `replyLineFlex_`:

```js
const res = UrlFetchApp.fetch(url, options);
const code = res.getResponseCode();
const body = res.getContentText().substring(0, 500);
Logger.log(`replyLineFlex_ status: ${code}, response: ${body}`);
return { success: code >= 200 && code < 300, status: code, body: body };
```

Update its catch path:

```js
Logger.log('replyLineFlex_ error: ' + e.message);
return { success: false, status: 0, body: String(e.message || e) };
```

- [ ] **Step 3: Run static regression test**

Run: `node tests/line-flex-schema-check.js`

Expected: exit code `0`.

- [ ] **Step 4: Run JavaScript syntax check**

Run: `node --check รหัส.js`

Expected: exit code `0` and no output.

- [ ] **Step 5: Commit**

```bash
git add รหัส.js tests/line-flex-schema-check.js package.json
git commit -m "fix: send valid LINE Reply Flex cards"
```

### Task 3: Deploy and verify the real webhook

**Files:**
- Modify: none unless deployment tooling updates metadata.

**Interfaces:**
- Consumes: deployed Apps Script Web App URL configured as the LINE Messaging API webhook.
- Produces: one Flex Reply shown in the LINE chat for each command.

- [ ] **Step 1: Push and redeploy Apps Script**

Run the project-approved deployment commands from `README.md`:

```bash
npx -y @google/clasp push
npx -y @google/clasp deploy -d "Production Deployment"
```

Record the returned Web App deployment URL. If the production deployment is an existing Web App deployment, update that deployment rather than creating an unused new URL.

- [ ] **Step 2: Confirm LINE webhook configuration**

In LINE Developers Console, set the Messaging API webhook URL to the active Apps Script Web App `/exec` URL and enable webhooks. Use the console's Verify action and confirm success.

- [ ] **Step 3: Manually reproduce the reported issue**

Send `ยืมอุปกรณ์` to the official account once. Confirm exactly one Flex Reply appears. Repeat with `จองรถ` and `รายการของฉัน`; these currently route to the help Flex card and must receive one Reply Flex each.

- [ ] **Step 4: Inspect Apps Script execution logs**

Confirm a `replyLineFlex_ status: 200` log entry after each manual test. If LINE returns non-2xx, use the logged response body to correct the specific rejected field before repeating deployment.

- [ ] **Step 5: Commit deployment metadata only if changed**

```bash
git add .clasp.json appsscript.json
git commit -m "chore: update Apps Script deployment metadata"
```
