const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('รหัส.js', 'utf8');

assert.match(source, /function replyLineFlex_\(/, 'Reply Flex helper must exist');
assert.doesNotMatch(
  source,
  /background:\s*\{\s*type:\s*["']linearGradient["']/,
  'LINE Flex does not accept a background gradient object; use backgroundColor'
);
