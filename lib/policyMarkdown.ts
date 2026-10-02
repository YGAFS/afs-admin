export type PolicyMetadata = {
  title: string
  version: string
  effectiveDate: string
  lastUpdated: string
}

function unquote(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  return trimmed
}

export function parsePolicyMarkdown(source: string) {
  const normalized = source.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
  if (!match) throw new Error('Policy frontmatter is required')
  const values = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    values.set(line.slice(0, separator).trim(), unquote(line.slice(separator + 1)))
  }
  const metadata: PolicyMetadata = {
    title: values.get('title') ?? '',
    version: values.get('version') ?? '',
    effectiveDate: values.get('effectiveDate') ?? '',
    lastUpdated: values.get('lastUpdated') ?? '',
  }
  if (!metadata.title || !metadata.version || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.effectiveDate) || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.lastUpdated)) {
    throw new Error('Policy frontmatter must include title, version, effectiveDate, and lastUpdated')
  }
  return { metadata, markdown: match[2].trim() }
}
