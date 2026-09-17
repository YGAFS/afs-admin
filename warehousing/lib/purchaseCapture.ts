export { parsePurchaseInput } from './purchaseParsers'
export type { ParsedPurchaseLine, ParsedPurchaseSuggestion, PurchaseParseInput, PurchaseParser } from './purchaseParsers'

import { parsePurchaseInput } from './purchaseParsers'

/** Backward-compatible helper for existing callers and deterministic tests. */
export function parsePurchaseText(text: string) {
  return parsePurchaseInput({ text })
}
