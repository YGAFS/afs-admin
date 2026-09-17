import type { ParsedPurchaseLine, ParsedPurchaseSuggestion, PurchaseParseInput, PurchaseParser } from './types'

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function amount(value: string | undefined, ocrMode = false) {
  if (!value) return undefined
  const normalized = value.replace(/,/g, '').replace(/[Oo]/g, '0')
  let parsed = Number(normalized)
  if (ocrMode && !/[.,]/.test(value) && /^\d{3,4}$/.test(normalized)) parsed /= 100
  return Number.isFinite(parsed) ? parsed : undefined
}

function isoDate(value: string | undefined) {
  if (!value) return undefined
  const normalized = value.trim().replace(/,/g, '')
  const named = normalized.match(/([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})/)
  if (named) {
    const month = MONTHS[named[1].toLowerCase()]
    if (month) return `${named[3]}-${String(month).padStart(2, '0')}-${named[2].padStart(2, '0')}`
  }
  const numeric = normalized.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)
  if (numeric) return `${numeric[3]}-${numeric[1].padStart(2, '0')}-${numeric[2].padStart(2, '0')}`
  return normalized.match(/\d{4}-\d{2}-\d{2}/)?.[0]
}

function compactText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\r/g, '').trim()
}

function cleanProductName(value: string) {
  return compactText(value)
    .replace(/^[a-z]{1,2}\s+(?=[A-Z0-9])/, '')
    .replace(/\s+[a-z]{1,2}$/, '')
    .trim()
}

function htmlData(html: string | undefined) {
  if (!html || typeof DOMParser === 'undefined') return { text: '', lines: [] as ParsedPurchaseLine[] }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const productLinks = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/dp/"], a[href*="/gp/product/"]'))
  const seen = new Set<string>()
  const lines: ParsedPurchaseLine[] = []
  for (const link of productLinks) {
    const name = compactText(link.textContent ?? '')
    const asin = link.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase()
    if (!name || name.length < 5 || seen.has(`${asin ?? ''}|${name}`)) continue
    seen.add(`${asin ?? ''}|${name}`)
    lines.push({ rawVendorProductName: name, vendorSku: asin, productUrl: link.href })
  }
  return { text: compactText(doc.body.innerText || doc.body.textContent || ''), lines }
}

function source(input: PurchaseParseInput) {
  const html = htmlData(input.html)
  return {
    text: html.text || compactText(input.text || input.ocrText || ''),
    htmlLines: html.lines,
  }
}

function labeledAmount(text: string, labels: RegExp[], ocrMode = false) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label.source}\\s*:?\\s*(?:CA|US)?[\\$S]?\\s*(-?[0-9Oo,]+(?:[.,][0-9Oo]{1,2})?)`, 'i'))
    const parsed = amount(match?.[1]?.replace(/,(?=\d{2}$)/, '.'), ocrMode)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function summedTax(text: string, ocrMode = false) {
  const rows = text.split(/\n+/).map(row => row.trim()).filter(Boolean)
  const values: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const taxLabel = row.match(/(?:gst\/?hst|pst\/?rst\/?qst|sales tax|^(?:estimated\s+)?tax)\s*:?/i)
    if (!taxLabel) continue
    const afterLabel = row.slice((taxLabel.index ?? 0) + taxLabel[0].length)
    let moneyMatch = afterLabel.match(/[\$S]\s*([0-9Oo,]+(?:[.,][0-9Oo]{1,2})?)/)
    if (!moneyMatch && ocrMode) moneyMatch = (rows[index - 1] ?? '').match(/[\$S]\s*([0-9Oo,]+(?:[.,][0-9Oo]{1,2})?)/)
    const parsed = amount(moneyMatch?.[1]?.replace(/,(?=\d{2}$)/, '.'), ocrMode)
    if (parsed !== undefined) values.push(parsed)
  }
  return values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)) : undefined
}

function extractShippingLocation(text: string) {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const start = lines.findIndex(line => /^(ship\s*to|shipping address)\b/i.test(line))
  if (start < 0) {
    return text.match(/\(from\s+[^)]+\)\s*\/\s*([^/\n]+?)\s*\/\s*[A-Z]{2,4}\s*\//i)?.[1]?.trim()
  }
  const captured: string[] = []
  for (let index = start + 1; index < Math.min(lines.length, start + 7); index += 1) {
    if (/^(change shipping|grand total)\b/i.test(lines[index])) break
    const leftColumn = lines[index]
      .split(/payment method|order summary|(?:rec\s+)?business visa|items?\s*\)?\s*subtotal|shipping\s*&\s*handling|buy\s+\d+|total before tax|estimated\s+(?:gst|pst)/i)[0]
      .replace(/[|—~]+/g, ' ')
      .trim()
    if (leftColumn) captured.push(leftColumn)
    if (/\b(?:Canada|USA|United States)\b/i.test(leftColumn)) break
  }
  return captured.join(', ') || undefined
}

function textLines(text: string, subtotal?: number, ocrMode = false): ParsedPurchaseLine[] {
  const rows = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const found: ParsedPurchaseLine[] = []

  for (let index = 0; index < rows.length; index += 1) {
    if (!/sold by\s*:/i.test(rows[index])) continue
    const nameParts: string[] = []
    for (let cursor = index - 1; cursor >= Math.max(0, index - 2); cursor -= 1) {
      const candidate = rows[cursor]
      if (/^(arriving|delivered|order details|ship to|payment method|order summary|buy it again)/i.test(candidate)) break
      if (/^[\$S]?\s*[0-9,.]+$/.test(candidate) || /^(qty|quantity)\s*:?\s*\d+/i.test(candidate)) continue
      nameParts.unshift(candidate.replace(/\(\s*(?:cancel items?|write a product review|track package).*$/i, '').trim())
    }
    const name = cleanProductName(nameParts.join(' '))
    if (!name || name.length < 4) continue
    const nearby = rows.slice(Math.max(0, index - 2), Math.min(rows.length, index + 8)).join(' ')
    const priceMatch = nearby.match(/[\$S]\s*([0-9Oo,]+(?:[.,][0-9Oo]{1,2})?)/)
    const quantityMatch = nearby.match(/(?:qty|quantity)\s*:?\s*(\d+(?:\.\d+)?)/i)
    let unitPrice = amount(priceMatch?.[1]?.replace(/,(?=\d{2}$)/, '.'), ocrMode)
    let quantity = quantityMatch ? Number(quantityMatch[1]) : undefined
    if (!quantity && ocrMode) {
      const circledQuantity = nearby.match(/(?:^|\s)(\d{1,3})\)\s/)
      if (circledQuantity) quantity = Number(circledQuantity[1])
    }
    if (!unitPrice && quantity && subtotal != null) unitPrice = Number((subtotal / quantity).toFixed(2))
    if (!quantity && found.length === 0 && subtotal != null && unitPrice && unitPrice > 0) {
      const derived = subtotal / unitPrice
      if (Math.abs(derived - Math.round(derived)) < 0.02) quantity = Math.round(derived)
    }
    found.push({
      rawVendorProductName: name,
      quantity,
      unitPrice,
      lineTotal: quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(2)) : undefined,
    })
  }
  return found
}

function mergeLines(htmlLines: ParsedPurchaseLine[], parsedLines: ParsedPurchaseLine[], subtotal?: number) {
  const base = htmlLines.length ? htmlLines : parsedLines
  return base.map((line, index) => {
    const detail = parsedLines[index]
    const merged = { ...detail, ...line }
    if (merged.lineTotal == null && merged.quantity != null && merged.unitPrice != null) merged.lineTotal = Number((merged.quantity * merged.unitPrice).toFixed(2))
    if (base.length === 1 && merged.lineTotal == null && subtotal != null) merged.lineTotal = subtotal
    return merged
  })
}

export const amazonParser: PurchaseParser = {
  id: 'amazon',
  canParse(input) {
    const value = `${input.html ?? ''}\n${input.text ?? ''}\n${input.ocrText ?? ''}`.toLowerCase()
    return value.includes('amazon') || /order\s+(?:number|#).*\d{3}\s*-\s*\d{7}\s*-\s*\d{7}/i.test(value)
  },
  parse(input): ParsedPurchaseSuggestion {
    const { text, htmlLines } = source(input)
    const ocrMode = !!input.ocrText && !input.text && !input.html
    const subtotal = labeledAmount(text, [/item\(s\) subtotal/, /items? subtotal/, /subtotal/], ocrMode)
    const parsedLines = textLines(text, subtotal, ocrMode)
    const dateMatch = text.match(/(?:order placed|order date|purchased on)\s*:?[ \t]*([A-Za-z]+\s+\d{1,2}\s*,?\s*\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})/i)
    const amazonOrder = text.match(/(?:order number|order #|order no\.?)\s*:?[ \t]*(\d{3})\s*[-—]\s*(\d{7})\s*[-—]\s*(\d{7})/i)
    const genericOrder = text.match(/(?:order number|order #|order no\.?|confirmation #)\s*:?[ \t]*([A-Z0-9-]{5,})/i)
    const cardSection = text.match(/payment method([\s\S]{0,160})/i)?.[1] ?? text
    const cardMatch = cardSection.match(/(?:card|visa|mastercard|master card|amex|ending in|\*{4}|•{4}|\.{4})[^\d]{0,28}(\d{4})(?!\d)/i)
      ?? cardSection.match(/(?:visa|mastercard|amex)[\s\S]{0,30}?(\d{4})(?!\d)/i)
    const orderNumber = amazonOrder ? `${amazonOrder[1]}-${amazonOrder[2]}-${amazonOrder[3]}` : genericOrder?.[1]
    const lines = mergeLines(htmlLines, parsedLines, subtotal)
    const suggestion: ParsedPurchaseSuggestion = {
      parserId: 'amazon',
      vendorName: 'Amazon',
      orderDate: isoDate(dateMatch?.[1]),
      orderNumber,
      subtotal,
      tax: summedTax(text, ocrMode),
      shipping: labeledAmount(text, [/shipping\s*&\s*handling/, /shipping/], ocrMode),
      total: labeledAmount(text, [/grand total/, /order total/, /total/], ocrMode),
      currency: /\bUSD\b|US\$/i.test(text) ? 'USD' : 'CAD',
      cardLast4: cardMatch?.[1],
      shippingLocationText: extractShippingLocation(text),
      lines,
      warnings: [],
    }
    if (!suggestion.orderNumber) suggestion.warnings.push('Order number was not recognized.')
    if (suggestion.total == null) suggestion.warnings.push('Order total was not recognized.')
    if (!suggestion.lines.length) suggestion.warnings.push('Product lines were not recognized.')
    return suggestion
  },
}
