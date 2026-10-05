'use client'

import { Fragment, type ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { portalFetch } from '@/lib/employeePortal'

type TocItem = { id: string; label: string; level: 2 | 3 | 4 }

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

function inlineMarkdown(value: string): ReactNode[] {
  return value.split(/(<mark(?:\s[^>]*)?>.*?<\/mark>|==.*?==|\*\*\*.*?\*\*\*|\*\*.*?\*\*|__.*?__|`.*?`|\*[^*\n]+\*|_[^_\n]+_)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('<mark')) return <mark key={index} className="rounded bg-yellow-200 px-1 text-ink">{inlineMarkdown(part.replace(/^<mark(?:\s[^>]*)?>/, '').replace(/<\/mark>$/, ''))}</mark>
    if (part.startsWith('==') && part.endsWith('==')) return <mark key={index} className="rounded bg-yellow-200 px-1 text-ink">{inlineMarkdown(part.slice(2, -2))}</mark>
    if (part.startsWith('***') && part.endsWith('***')) return <strong key={index}><em>{part.slice(3, -3)}</em></strong>
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-pill px-1.5 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={index}>{part.slice(1, -1)}</em>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function isBlockStart(line: string) {
  return /^(#{1,4})\s|^[-*_]{3,}\s*$|^[-*]\s|^\d+\.\s|^>\s?|^<mark(?:\s[^>]*)?>\s*[-*]\s/.test(line)
}

function renderBlocks(lines: string[], keyPrefix: string, skipTitle = false): ReactNode[] {
  const output: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) { index += 1; continue }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const label = heading[2].trim()
      if (level === 1 && skipTitle) { index += 1; continue }
      const id = slugify(label)
      const className = level === 2 ? 'mb-3 mt-10 scroll-mt-24 text-2xl font-bold text-ink first:mt-0' : level === 3 ? 'mb-2 mt-7 scroll-mt-24 text-lg font-bold text-ink' : level === 4 ? 'mb-2 mt-6 scroll-mt-24 text-base font-bold text-ink' : 'mb-4 mt-2 scroll-mt-24 text-3xl font-bold text-ink'
      const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4'
      output.push(<Heading key={`${keyPrefix}-${index}`} id={id} className={className}>{inlineMarkdown(label)}</Heading>)
      index += 1
      continue
    }

    if (/^[-*_]{3,}\s*$/.test(line)) { output.push(<hr key={`${keyPrefix}-${index}`} className="my-8 border-line-soft" />); index += 1; continue }

    const markedList = line.match(/^<mark(?:\s[^>]*)?>\s*[-*]\s+(.+?)<\/mark>$/)
    if (markedList) {
      output.push(<ul key={`${keyPrefix}-${index}`} className="mb-4 list-disc space-y-2 pl-6 leading-7"><li><mark className="rounded bg-yellow-200 px-1 text-ink">{inlineMarkdown(markedList[1])}</mark></li></ul>)
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length) { const item = lines[index].trim().match(/^[-*]\s+(.+)$/); if (!item) break; items.push(item[1]); index += 1 }
      output.push(<ul key={`${keyPrefix}-${index}`} className="mb-4 list-disc space-y-2 pl-6 leading-7">{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>)
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length) { const item = lines[index].trim().match(/^\d+\.\s+(.+)$/); if (!item) break; items.push(item[1]); index += 1 }
      output.push(<ol key={`${keyPrefix}-${index}`} className="mb-4 list-decimal space-y-2 pl-6 leading-7">{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>)
      continue
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) { quoteLines.push(lines[index].trim().slice(1).trimStart()); index += 1 }
      output.push(<blockquote key={`${keyPrefix}-${index}`} className="mb-4 border-l-4 border-line pl-4 italic leading-7 text-ink-muted">{quoteLines.map((quote, quoteIndex) => <p key={quoteIndex}>{inlineMarkdown(quote)}</p>)}</blockquote>)
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index].trim())) { paragraph.push(lines[index].trim()); index += 1 }
    output.push(<p key={`${keyPrefix}-${index}`} className="mb-4 leading-7 text-ink">{inlineMarkdown(paragraph.join(' '))}</p>)
  }
  return output
}

function PolicyMarkdown({ source }: { source: string }) {
  const [tocScrolling, setTocScrolling] = useState(false)
  const tocTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lines = source.split(/\r?\n/)
  const headings = lines.map((line, index) => {
    const match = line.trim().match(/^(#{2,4})\s+(.+)$/)
    return match ? { id: slugify(match[2]), label: match[2], level: match[1].length as 2 | 3 | 4, index } : null
  }).filter((item): item is TocItem & { index: number } => !!item)
  const definitionIndex = headings.find(item => /definitions|용어/i.test(item.label))?.index
  const nextHeadingIndex = definitionIndex === undefined ? undefined : headings.find(item => item.index > definitionIndex && item.level === 2)?.index
  const beforeDefinitions = definitionIndex === undefined ? lines : lines.slice(0, definitionIndex)
  const definitions = definitionIndex === undefined ? [] : lines.slice(definitionIndex, nextHeadingIndex ?? lines.length)
  const afterDefinitions = definitionIndex === undefined ? [] : lines.slice(nextHeadingIndex ?? lines.length)

  return <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
    <article className="min-w-0 rounded-3xl border border-line-soft bg-white p-7 shadow-sm md:p-10">
      {renderBlocks(beforeDefinitions, 'before', true)}
      {definitions.length > 0 && <details className="mb-6 overflow-hidden rounded-2xl border border-line-soft bg-pill">
        <summary id="definitions-and-scope" className="cursor-pointer select-none px-5 py-4 font-bold text-ink">Definitions and Scope</summary>
        <div className="border-t border-line-soft px-5 pb-2 pt-1">{renderBlocks(definitions.slice(1), 'definitions', false)}</div>
      </details>}
      {renderBlocks(afterDefinitions, 'after', false)}
    </article>
    {headings.length > 0 && <aside className="order-first self-start lg:order-last lg:sticky lg:top-6"><nav onScroll={() => { setTocScrolling(true); if (tocTimer.current) clearTimeout(tocTimer.current); tocTimer.current = setTimeout(() => setTocScrolling(false), 700) }} className={`policy-toc-scrollbar max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl border border-line-soft bg-white p-4 shadow-sm ${tocScrolling ? 'is-scrolling' : ''}`} aria-label="Table of contents">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink">Contents</p>
      <div className="space-y-1">{headings.map(item => <a key={`${item.id}-${item.index}`} href={`#${item.id}`} className={`block rounded-lg px-2 py-1.5 text-sm leading-5 text-ink hover:bg-pill ${item.level === 3 ? 'ml-3' : item.level === 4 ? 'ml-6 text-xs' : 'font-semibold'}`}>{inlineMarkdown(item.label)}</a>)}</div>
    </nav></aside>}
  </div>
}

export default function PolicyPage() {
  const [data, setData] = useState<any>()
  const [error, setError] = useState(false)
  useEffect(() => {
    portalFetch('/api/employee-portal/me/pto-policy').then(async response => {
      if (response.status === 401 || response.status === 403) { window.location.replace('/portal/login'); return }
      if (!response.ok) setError(true); else setData(await response.json())
    }).catch(() => setError(true))
  }, [])
  const title = useMemo(() => data?.policy?.metadata?.title || 'PTO and Attendance Policy', [data])
  if (error) return <div className="p-8 text-sm text-ink-muted">Unable to load your PTO policy.</div>
  if (!data) return <div className="p-8 text-sm text-ink-muted">Loading policy…</div>
  return <div className="policy-obsidian mx-auto max-w-6xl p-6 md:p-10">
    <header className="mb-8"><p className="mb-2 text-sm font-medium text-signal-pos">{data.company.name}</p><h1 className="text-3xl font-bold text-ink">{title}</h1>{data.policy?.metadata && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted"><span>Version {data.policy.metadata.version}</span><span>Effective {data.policy.metadata.effectiveDate}</span><span>Last updated {data.policy.metadata.lastUpdated}</span></div>}</header>
    {data.policy ? <PolicyMarkdown source={data.policy.markdown} /> : <article className="rounded-3xl border border-line-soft bg-white p-7 shadow-sm md:p-10"><p className="text-ink-muted">The PTO and Attendance Policy for your company has not been published yet.</p></article>}
  </div>
}
