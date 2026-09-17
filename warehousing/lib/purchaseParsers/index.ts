import { amazonParser } from './amazon'
import type { ParsedPurchaseSuggestion, PurchaseParseInput, PurchaseParser } from './types'

const parsers: PurchaseParser[] = [
  amazonParser,
  // Future vendor parsers belong here: Uline, Staples, ...
]

export function parsePurchaseInput(input: PurchaseParseInput): ParsedPurchaseSuggestion {
  const parser = parsers.find(candidate => candidate.canParse(input))
  if (!parser) {
    return {
      parserId: null,
      lines: [],
      warnings: ['No supported vendor parser matched this content.'],
    }
  }
  return parser.parse(input)
}

export type { ParsedPurchaseLine, ParsedPurchaseSuggestion, PurchaseParseInput, PurchaseParser } from './types'
