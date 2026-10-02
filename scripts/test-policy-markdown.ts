import assert from 'node:assert/strict'
import { parsePolicyMarkdown } from '../lib/policyMarkdown.ts'

const parsed = parsePolicyMarkdown(`---
title: PTO and Attendance Policy
version: "1.2"
effectiveDate: 2026-10-01
lastUpdated: 2026-09-29
---
# Policy

Employees should review this policy.
`)

assert.deepEqual(parsed.metadata, {
  title: 'PTO and Attendance Policy',
  version: '1.2',
  effectiveDate: '2026-10-01',
  lastUpdated: '2026-09-29',
})
assert.match(parsed.markdown, /^# Policy/)
assert.throws(() => parsePolicyMarkdown('# Missing frontmatter'))
assert.throws(() => parsePolicyMarkdown(`---
title: Incomplete
version: "1"
---
Body`))

console.log('Policy frontmatter tests passed')
