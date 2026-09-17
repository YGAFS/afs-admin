export type ParsedPurchaseLine = {
  rawVendorProductName: string
  vendorSku?: string
  productUrl?: string
  quantity?: number
  unitPrice?: number
}

export type ParsedPurchaseSuggestion = {
  vendorName?: string
  orderDate?: string
  orderNumber?: string
  subtotal?: number
  tax?: number
  shipping?: number
  total?: number
  currency?: 'CAD' | 'USD'
  cardLast4?: string
  lines: ParsedPurchaseLine[]
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function amount(value: string | undefined) {
  if (!value) return undefined
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function isoDate(value: string | undefined) {
  if (!value) return undefined
  const normalized = value.trim().replace(/,/g, '')

  const named = normalized.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/)
  if (named) {
    const month = MONTHS[named[1].toLowerCase()]
    if (month) return `${named[3]}-${String(month).padStart(2, '0')}-${named[2].padStart(2, '0')}`
  }

  const numeric = normalized.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)
  if (numeric) return `${numeric[3]}-${numeric[1].padStart(2, '0')}-${numeric[2].padStart(2, '0')}`

  const alreadyIso = normalized.match(/(\d{4})-(\d{2})-(\d{2})/)
  return alreadyIso?.[0]
}

function labeledAmount(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*:?\\s*(?:CA|US)?\\$?\\s*(-?[0-9,]+(?:\\.[0-9]{1,2})?)`, 'i'))
    const parsed = amount(match?.[1])
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function summedTax(text: string) {
  const matches = Array.from(text.matchAll(/(?:estimated\s+)?(?:gst\/?hst|pst\/?rst\/?qst|sales tax|tax)\s*:?\s*(?:CA|US)?\$?\s*(-?[0-9,]+(?:\.[0-9]{1,2})?)/gi))
  const values = matches.map(match => amount(match[1])).filter((value): value is number => value !== undefined)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined
}

function inferAmazonLine(text: string): ParsedPurchaseLine[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const found: ParsedPurchaseLine[] = []

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^sold by\s*:/i.test(lines[index])) continue
    let candidateIndex = index - 1
    while (candidateIndex >= 0 && (
      /^\$?[0-9,.]+$/.test(lines[candidateIndex]) ||
      /^(qty|quantity)\s*:?\s*\d+/i.test(lines[candidateIndex]) ||
      /^(buy it again|write a product review|track package|cancel items)$/i.test(lines[candidateIndex])
    )) candidateIndex -= 1

    const name = lines[candidateIndex]
    if (!name || name.length < 3) continue
    const nearby = lines.slice(candidateIndex, Math.min(lines.length, index + 5)).join(' ')
    const priceMatch = nearby.match(/\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/)
    const quantityMatch = nearby.match(/(?:qty|quantity)\s*:?\s*(\d+(?:\.\d+)?)/i)
    found.push({
      rawVendorProductName: name,
      quantity: quantityMatch ? Number(quantityMatch[1]) : 1,
      unitPrice: amount(priceMatch?.[1]),
    })
  }

  return found.filter((line, index) => found.findIndex(other => other.rawVendorProductName === line.rawVendorProductName) === index)
}

/**
 * Best-effort, deterministic extraction for pasted order text. The result is
 * always a suggestion for human review; it is never treated as authoritative.
 */
export function parsePurchaseText(input: string): ParsedPurchaseSuggestion {
  const text = input.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  const lower = text.toLowerCase()

  const vendorName = lower.includes('amazon')
    ? 'Amazon'
    : lower.includes('uline')
      ? 'Uline'
      : undefined

  const dateMatch = text.match(/(?:order placed|order date|purchased on)\s*:?[ \t]*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})/i)
  const orderMatch = text.match(/(?:order number|order #|order no\.?|confirmation #)\s*:?[ \t]*([A-Z0-9-]{5,})/i)
  const cardMatch = text.match(/(?:card|visa|mastercard|master card|amex|ending in|\*{4}|•{4})[^\d]{0,24}(\d{4})(?!\d)/i)
  const asinMatch = text.match(/\bASIN\s*:?\s*([A-Z0-9]{10})\b/i)

  const parsedLines = vendorName === 'Amazon' ? inferAmazonLine(text) : []
  if (parsedLines.length === 1 && asinMatch) parsedLines[0].vendorSku = asinMatch[1].toUpperCase()

  return {
    vendorName,
    orderDate: isoDate(dateMatch?.[1]),
    orderNumber: orderMatch?.[1],
    subtotal: labeledAmount(text, ['item\\(s\\) subtotal', 'items subtotal', 'subtotal']),
    tax: summedTax(text),
    shipping: labeledAmount(text, ['shipping & handling', 'shipping']),
    total: labeledAmount(text, ['grand total', 'order total', 'total']),
    currency: /\bUSD\b|US\$/i.test(text) ? 'USD' : 'CAD',
    cardLast4: cardMatch?.[1],
    lines: parsedLines,
  }
}
