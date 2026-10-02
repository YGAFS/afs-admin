import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parsePolicyMarkdown } from '@/lib/policyMarkdown'

export async function loadPolicyDocument(companyCode: string) {
  const code = companyCode.trim().toLowerCase()
  if (!['afs', 'tnt', 'zfs'].includes(code)) return null
  const file = path.join(process.cwd(), 'content', 'policies', code, 'pto-attendance-policy.md')
  try {
    return parsePolicyMarkdown(await readFile(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
