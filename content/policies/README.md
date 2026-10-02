# Employee Portal policies

Git-tracked Markdown is the source of truth. Add a policy only after HR approves
its text:

```text
content/policies/afs/pto-attendance-policy.md
content/policies/tnt/pto-attendance-policy.md
content/policies/zfs/pto-attendance-policy.md
```

Every policy must start with:

```yaml
---
title: PTO and Attendance Policy
version: "1.0"
effectiveDate: 2026-10-01
lastUpdated: 2026-09-29
---
```

Do not place confidential employee information in policy files. Changes are
reviewed through Git history; there is no Production CMS or upload workflow.
