export type ParsedPurchaseLine = {
  rawVendorProductName: string
  vendorSku?: string
  productUrl?: string
  quantity?: number
  unitPrice?: number
  lineTotal?: number
}

export type ParsedPurchaseSuggestion = {
  parserId: string | null
  vendorName?: string
  orderDate?: string
  orderNumber?: string
  subtotal?: number
  tax?: number
  shipping?: number
  total?: number
  currency?: 'CAD' | 'USD'
  cardLast4?: string
  shippingLocationText?: string
  lines: ParsedPurchaseLine[]
  warnings: string[]
}

export type PurchaseParseInput = {
  html?: string
  text?: string
  ocrText?: string
}

export interface PurchaseParser {
  id: string
  canParse(input: PurchaseParseInput): boolean
  parse(input: PurchaseParseInput): ParsedPurchaseSuggestion
}
