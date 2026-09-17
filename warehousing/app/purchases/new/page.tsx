'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@/app/providers'
import { parsePurchaseText, type ParsedPurchaseSuggestion } from '@/lib/purchaseCapture'
import type { Category, CompanyId, Location, PaymentMethod } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

type Currency = 'CAD' | 'USD'
type Classification = 'unclassified' | 'existing' | 'new'
type AttachmentType = 'invoice' | 'receipt' | 'screenshot' | 'other'

type ItemOption = {
  id: string
  name: string
  image_url: string | null
}

type VendorRef = {
  id: string
  item_id: string
  vendor_key: string
  vendor_sku_key: string | null
  product_url: string | null
}

type LineDraft = {
  key: string
  rawVendorProductName: string
  vendorSku: string
  productUrl: string
  quantity: string
  unitPrice: string
  classification: Classification
  itemId: string
  newItemName: string
  newItemImageUrl: string
}

type AttachmentDraft = {
  key: string
  file: File
  attachmentType: AttachmentType
}

const COMPANIES: Array<{ id: CompanyId; label: string }> = [
  { id: 'afs', label: 'AFS' },
  { id: 'tnt', label: 'TNT' },
  { id: 'zfs', label: 'ZFS' },
]

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function emptyLine(): LineDraft {
  return {
    key: crypto.randomUUID(),
    rawVendorProductName: '',
    vendorSku: '',
    productUrl: '',
    quantity: '1',
    unitPrice: '',
    classification: 'unclassified',
    itemId: '',
    newItemName: '',
    newItemImageUrl: '',
  }
}

function numberOrNull(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function vendorKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function skuKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_') || 'attachment'
}

function htmlToText(html: string) {
  return new DOMParser().parseFromString(html, 'text/html').body.innerText
}

export default function NewPurchasePage() {
  const { user, role, locale } = useAuth()
  const isKo = locale === 'ko'
  const fileInput = useRef<HTMLInputElement>(null)

  const [companyId, setCompanyId] = useState<CompanyId>('afs')
  const [vendorName, setVendorName] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [locationId, setLocationId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('Office Supplies')
  const [subtotal, setSubtotal] = useState('')
  const [tax, setTax] = useState('')
  const [shipping, setShipping] = useState('')
  const [total, setTotal] = useState('')
  const [currency, setCurrency] = useState<Currency>('CAD')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([])

  const [locations, setLocations] = useState<Location[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [items, setItems] = useState<ItemOption[]>([])
  const [vendorRefs, setVendorRefs] = useState<VendorRef[]>([])

  const [parseMessage, setParseMessage] = useState<string | null>(null)
  const [clipboardBusy, setClipboardBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; purchaseNumber: string; warnings: string[] } | null>(null)

  useEffect(() => {
    supabase.from('purchase_categories').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => setCategories((data as Category[]) ?? []))
    supabase.from('items').select('id,name,image_url').order('name')
      .then(({ data }) => setItems((data as ItemOption[]) ?? []))
    supabase.from('item_vendor_refs').select('id,item_id,vendor_key,vendor_sku_key,product_url')
      .then(({ data }) => setVendorRefs((data as VendorRef[]) ?? []))
  }, [])

  useEffect(() => {
    setLocationId('')
    setPaymentMethodId('')
    supabase.from('utility_locations').select('id,company_id,name,region,city,address').eq('company_id', companyId).order('sort_order')
      .then(({ data }) => setLocations((data as Location[]) ?? []))
    supabase.from('payment_methods').select('id,company_id,label').eq('company_id', companyId).order('label')
      .then(({ data }) => setPaymentMethods((data as PaymentMethod[]) ?? []))
  }, [companyId])

  const itemById = useMemo(() => Object.fromEntries(items.map(item => [item.id, item])), [items])
  const selectedLocation = locations.find(location => location.id === locationId)
  const companyLabel = companyId.toUpperCase()
  const money = total ? `${currency === 'USD' ? 'US$' : '$'}${Number(total).toFixed(2)}` : '$0.00'
  const emailSubject = `${orderDate || 'YYYY-MM-DD'} / ${money} / card ${cardLast4 || '0000'} / ${companyLabel} ${description.trim() || 'Purchase'} (from ${vendorName.trim() || 'Vendor'}) / ${selectedLocation?.city || selectedLocation?.name || 'Location'} / ${companyLabel}/`
  const emailBody = `Hi Timothy,\n\nPlease find the invoice below.\n\nPurchase date: ${orderDate || '-'}\nVendor: ${vendorName || '-'}\nOrder number: ${orderNumber || '-'}\nTotal: ${money}\nCompany: ${companyLabel}\nLocation: ${selectedLocation?.name || '-'}\n\nThank you.`

  function patchLine(key: string, patch: Partial<LineDraft>) {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line))
  }

  function appendFiles(files: File[], attachmentType?: AttachmentType) {
    const accepted: AttachmentDraft[] = []
    const rejected: string[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        rejected.push(`${file.name}: maximum size is 25 MB`)
        continue
      }
      accepted.push({
        key: crypto.randomUUID(),
        file,
        attachmentType: attachmentType ?? (file.type.startsWith('image/') ? 'screenshot' : file.type === 'application/pdf' ? 'invoice' : 'other'),
      })
    }
    setAttachments(current => [...current, ...accepted])
    if (rejected.length) setError(rejected.join('\n'))
  }

  function applySuggestion(suggestion: ParsedPurchaseSuggestion, sourceText: string) {
    if (suggestion.vendorName) setVendorName(current => current || suggestion.vendorName || '')
    if (suggestion.orderDate) setOrderDate(current => current || suggestion.orderDate || '')
    if (suggestion.orderNumber) setOrderNumber(current => current || suggestion.orderNumber || '')
    if (suggestion.subtotal !== undefined) setSubtotal(current => current || String(suggestion.subtotal))
    if (suggestion.tax !== undefined) setTax(current => current || String(suggestion.tax))
    if (suggestion.shipping !== undefined) setShipping(current => current || String(suggestion.shipping))
    if (suggestion.total !== undefined) setTotal(current => current || String(suggestion.total))
    if (suggestion.currency) setCurrency(suggestion.currency)
    if (suggestion.cardLast4) setCardLast4(current => current || suggestion.cardLast4 || '')

    if (suggestion.lines.length) {
      setLines(current => {
        const currentIsEmpty = current.length === 1 && !current[0].rawVendorProductName.trim()
        const parsed = suggestion.lines.map(line => ({
          ...emptyLine(),
          rawVendorProductName: line.rawVendorProductName,
          vendorSku: line.vendorSku ?? '',
          productUrl: line.productUrl ?? '',
          quantity: line.quantity == null ? '1' : String(line.quantity),
          unitPrice: line.unitPrice == null ? '' : String(line.unitPrice),
        }))
        return currentIsEmpty ? parsed : [...current, ...parsed]
      })
    }

    const possibleLocation = locations.find(location => {
      const haystack = sourceText.toLowerCase()
      return haystack.includes(location.name.toLowerCase()) || !!location.city && haystack.includes(location.city.toLowerCase())
    })
    if (possibleLocation) setLocationId(current => current || possibleLocation.id)

    const extracted = [suggestion.vendorName, suggestion.orderDate, suggestion.orderNumber, suggestion.total, suggestion.cardLast4]
      .filter(value => value !== undefined).length
    setParseMessage(isKo
      ? `텍스트는 저장하지 않고 브라우저에서 분석했습니다. ${extracted}개 주요 필드를 제안했습니다.`
      : `The text was parsed locally and was not stored. ${extracted} key fields were suggested.`)
  }

  function parseText(text: string) {
    if (!text.trim()) return
    applySuggestion(parsePurchaseText(text), text)
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    setError(null)
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file)
    if (files.length) appendFiles(files, 'screenshot')

    const plain = event.clipboardData.getData('text/plain')
    const html = event.clipboardData.getData('text/html')
    parseText(plain || (html ? htmlToText(html) : ''))
    if (!files.length && !plain && !html) setError(isKo ? '붙여넣을 수 있는 이미지나 텍스트가 없습니다.' : 'No supported image or text was found on the clipboard.')
  }

  async function readClipboard() {
    setClipboardBusy(true)
    setError(null)
    try {
      if (!navigator.clipboard?.read) throw new Error(isKo ? '이 브라우저는 직접 클립보드 읽기를 지원하지 않습니다. Ctrl+V를 사용해 주세요.' : 'Direct clipboard reading is not supported. Use Ctrl+V instead.')
      const clipboardItems = await navigator.clipboard.read()
      const files: File[] = []
      const textParts: string[] = []
      for (const clipboardItem of clipboardItems) {
        for (const type of clipboardItem.types) {
          const blob = await clipboardItem.getType(type)
          if (type.startsWith('image/')) {
            const extension = type.split('/')[1] || 'png'
            files.push(new File([blob], `clipboard-${Date.now()}.${extension}`, { type }))
          } else if (type === 'text/plain') {
            textParts.push(await blob.text())
          } else if (type === 'text/html' && !clipboardItem.types.includes('text/plain')) {
            textParts.push(htmlToText(await blob.text()))
          }
        }
      }
      if (files.length) appendFiles(files, 'screenshot')
      parseText(textParts.join('\n'))
      if (!files.length && !textParts.length) throw new Error(isKo ? '지원되는 클립보드 내용이 없습니다.' : 'No supported clipboard content was found.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (isKo ? '클립보드를 읽지 못했습니다.' : 'Could not read the clipboard.'))
    } finally {
      setClipboardBusy(false)
    }
  }

  function suggestedItem(line: LineDraft) {
    if (!vendorName.trim() || !line.vendorSku.trim()) return null
    const known = vendorRefs.find(ref => ref.vendor_key === vendorKey(vendorName) && ref.vendor_sku_key === skuKey(line.vendorSku))
    return known ? itemById[known.item_id] ?? null : null
  }

  async function addVendorRef(itemId: string, line: LineDraft) {
    if (!vendorName.trim() || (!line.vendorSku.trim() && !line.productUrl.trim())) return null
    const key = vendorKey(vendorName)
    const sku = line.vendorSku.trim() ? skuKey(line.vendorSku) : null
    const existing = vendorRefs.find(ref => ref.vendor_key === key && (
      sku ? ref.vendor_sku_key === sku : !!line.productUrl.trim() && ref.product_url === line.productUrl.trim()
    ))
    if (existing) return existing.item_id === itemId ? null : `Vendor reference for ${line.vendorSku || line.productUrl} already belongs to another Item.`

    const { error: refError } = await supabase.from('item_vendor_refs').insert({
      item_id: itemId,
      vendor_name: vendorName.trim(),
      vendor_key: key,
      vendor_sku: line.vendorSku.trim() || null,
      vendor_sku_key: sku,
      product_url: line.productUrl.trim() || null,
    })
    return refError?.message ?? null
  }

  async function saveDraft() {
    if (!user?.id || !user.email) return
    setSaving(true)
    setError(null)
    setSaved(null)

    const card = cardLast4.trim()
    if (card && !/^\d{4}$/.test(card)) {
      setError(isKo ? '카드 끝 4자리는 숫자 4자리여야 합니다.' : 'Card last 4 must contain exactly four digits.')
      setSaving(false)
      return
    }

    for (const line of lines) {
      const suggestion = suggestedItem(line)
      if (suggestion && line.classification !== 'unclassified') {
        const selectedId = line.classification === 'existing' ? line.itemId : null
        if (!selectedId || selectedId !== suggestion.id) {
          setError(isKo
            ? `${line.vendorSku}는 이미 “${suggestion.name}” 품목에 연결되어 있습니다. 제안 품목을 선택하거나 미분류로 저장해 주세요.`
            : `${line.vendorSku} is already linked to “${suggestion.name}”. Use the suggested Item or leave the line unclassified.`)
          setSaving(false)
          return
        }
      }
      if (line.classification === 'existing' && !line.itemId) {
        setError(isKo ? '기존 품목 연결을 선택한 행에서 품목을 골라 주세요.' : 'Choose an Item for every line marked “Link existing”.')
        setSaving(false)
        return
      }
      if (line.classification === 'new' && !line.newItemName.trim()) {
        setError(isKo ? '새 품목 이름을 입력해 주세요.' : 'Enter a name for every new Item.')
        setSaving(false)
        return
      }
    }

    const { data: purchase, error: purchaseError } = await supabase.from('purchases').insert({
      company_id: companyId,
      location_id: locationId || null,
      vendor_name: vendorName.trim() || null,
      order_date: orderDate || null,
      order_number: orderNumber.trim() || null,
      description: description.trim() || null,
      category_id: categoryId || null,
      subtotal: numberOrNull(subtotal),
      tax: numberOrNull(tax),
      shipping: numberOrNull(shipping),
      total: numberOrNull(total),
      currency,
      payment_method_id: paymentMethodId || null,
      card_last4_snapshot: card || null,
      status: 'draft',
      created_by_user_id: user.id,
      created_by_email: user.email,
    }).select('id,purchase_number').single()

    if (purchaseError || !purchase) {
      setError(purchaseError?.message ?? (isKo ? '구매 임시저장을 만들지 못했습니다.' : 'Could not create the purchase draft.'))
      setSaving(false)
      return
    }

    const warnings: string[] = []
    const persistedLines = lines.filter(line => line.rawVendorProductName.trim())
    let insertedLineIds: string[] = []
    if (persistedLines.length) {
      const { data: inserted, error: lineError } = await supabase.from('purchase_lines').insert(persistedLines.map(line => ({
        purchase_id: purchase.id,
        item_id: line.classification === 'existing' ? line.itemId : null,
        raw_vendor_product_name: line.rawVendorProductName.trim(),
        vendor_sku: line.vendorSku.trim() || null,
        product_url: line.productUrl.trim() || null,
        quantity: numberOrNull(line.quantity),
        unit_price: numberOrNull(line.unitPrice),
        line_subtotal: numberOrNull(line.quantity) != null && numberOrNull(line.unitPrice) != null
          ? Number(numberOrNull(line.quantity)) * Number(numberOrNull(line.unitPrice))
          : null,
      }))).select('id')
      if (lineError) warnings.push(`Line items: ${lineError.message}`)
      insertedLineIds = inserted?.map(row => row.id) ?? []
    }

    for (let index = 0; index < persistedLines.length; index += 1) {
      const line = persistedLines[index]
      const lineId = insertedLineIds[index]
      if (!lineId) continue

      if (line.classification === 'existing' && line.itemId) {
        const refWarning = await addVendorRef(line.itemId, line)
        if (refWarning) warnings.push(refWarning)
      }

      if (line.classification === 'new') {
        const { data: newItem, error: itemError } = await supabase.from('items').insert({
          name: line.newItemName.trim(),
          category_id: categoryId || null,
          image_url: line.newItemImageUrl.trim() || null,
          created_by: user.id,
        }).select('id').single()
        if (itemError || !newItem) {
          warnings.push(`Item “${line.newItemName}”: ${itemError?.message ?? 'not created'}`)
          continue
        }
        const { error: linkError } = await supabase.from('purchase_lines').update({ item_id: newItem.id }).eq('id', lineId)
        if (linkError) warnings.push(`Item link “${line.newItemName}”: ${linkError.message}`)
        const refWarning = await addVendorRef(newItem.id, line)
        if (refWarning) warnings.push(refWarning)
      }
    }

    for (const attachment of attachments) {
      const path = `purchases/${purchase.id}/${crypto.randomUUID()}-${safeFileName(attachment.file.name)}`
      const { error: uploadError } = await supabase.storage.from('purchase-attachments').upload(path, attachment.file, { contentType: attachment.file.type || undefined })
      if (uploadError) {
        warnings.push(`${attachment.file.name}: ${uploadError.message}`)
        continue
      }
      const { error: metadataError } = await supabase.from('purchase_attachments').insert({
        purchase_id: purchase.id,
        storage_path: path,
        file_name: attachment.file.name,
        mime_type: attachment.file.type || null,
        size_bytes: attachment.file.size,
        attachment_type: attachment.attachmentType,
        uploaded_by_user_id: user.id,
      })
      if (metadataError) warnings.push(`${attachment.file.name}: ${metadataError.message}`)
    }

    setSaved({ id: purchase.id, purchaseNumber: purchase.purchase_number, warnings })
    setSaving(false)
  }

  if (!role || role === 'none') return null
  if (role !== 'purchasing' && role !== 'admin') {
    return <div className="p-8 text-sm text-ink-muted">{isKo ? '구매 담당자 권한이 필요합니다.' : 'Purchasing access is required.'}</div>
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">{isKo ? '새 구매 등록' : 'New Purchase'}</h1>
        <p className="text-sm text-ink-faint mt-1">
          {isKo ? '주문 정보나 스크린샷을 붙여넣고, 제안된 내용을 검토한 뒤 임시저장하세요.' : 'Paste order information or a screenshot, review the suggestions, and save a draft.'}
        </p>
      </div>

      <section className="bg-white rounded-2xl border border-line-soft p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">1. {isKo ? '클립보드 / 첨부' : 'Clipboard / Attachments'}</h2>
            <p className="text-xs text-ink-faint mt-1">{isKo ? '붙여넣은 HTML과 텍스트는 분석 후 저장하지 않습니다.' : 'Pasted HTML and text are parsed transiently and are not stored.'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={readClipboard} disabled={clipboardBusy} className="px-3 py-1.5 text-xs text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint">
              {clipboardBusy ? (isKo ? '읽는 중…' : 'Reading...') : (isKo ? '클립보드에서 붙여넣기' : 'Paste from Clipboard')}
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} className="px-3 py-1.5 text-xs text-ink-muted border border-line rounded-lg hover:bg-pill">
              {isKo ? '파일 선택' : 'Choose Files'}
            </button>
            <input ref={fileInput} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={event => appendFiles(Array.from(event.target.files ?? []))} />
          </div>
        </div>

        <div onPaste={handlePaste} tabIndex={0} className="min-h-32 border-2 border-dashed border-line rounded-xl flex flex-col items-center justify-center text-center p-6 outline-none focus:border-ink cursor-text">
          <div className="text-2xl mb-2">📋</div>
          <div className="text-sm font-medium text-ink">{isKo ? '여기를 클릭하고 Ctrl+V' : 'Click here and press Ctrl+V'}</div>
          <div className="text-xs text-ink-faint mt-1">{isKo ? '주문 텍스트, HTML, 이미지 또는 스크린샷' : 'Order text, HTML, image, or screenshot'}</div>
        </div>

        {parseMessage && <div className="text-xs text-signal-pos bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">{parseMessage}</div>}

        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map(attachment => (
              <div key={attachment.key} className="flex items-center gap-3 border border-line-soft rounded-lg px-3 py-2">
                <span className="text-sm">📎</span>
                <span className="text-sm text-ink flex-1 truncate">{attachment.file.name}</span>
                <span className="text-xs text-ink-faint">{(attachment.file.size / 1024 / 1024).toFixed(2)} MB</span>
                <select value={attachment.attachmentType} onChange={event => setAttachments(current => current.map(value => value.key === attachment.key ? { ...value, attachmentType: event.target.value as AttachmentType } : value))} className="border border-line rounded-lg px-2 py-1 text-xs">
                  <option value="invoice">Invoice</option>
                  <option value="receipt">Receipt</option>
                  <option value="screenshot">Screenshot</option>
                  <option value="other">Other</option>
                </select>
                <button type="button" onClick={() => setAttachments(current => current.filter(value => value.key !== attachment.key))} className="text-xs text-ink-faint hover:text-signal-neg">{isKo ? '제거' : 'Remove'}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-line-soft p-6 space-y-5">
        <h2 className="text-sm font-semibold text-ink">2. {isKo ? '구매 정보 검토' : 'Review Purchase Details'}</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label={isKo ? '회사' : 'Company'}>
            <select value={companyId} onChange={event => setCompanyId(event.target.value as CompanyId)} className={inputClass}>{COMPANIES.map(company => <option key={company.id} value={company.id}>{company.label}</option>)}</select>
          </Field>
          <Field label={isKo ? '구매처' : 'Vendor'}>
            <input value={vendorName} onChange={event => setVendorName(event.target.value)} className={inputClass} placeholder="Amazon" />
          </Field>
          <Field label={isKo ? '주문일' : 'Order Date'}>
            <input type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} className={inputClass} />
          </Field>
          <Field label={isKo ? '주문번호' : 'Order Number'}>
            <input value={orderNumber} onChange={event => setOrderNumber(event.target.value)} className={inputClass} />
          </Field>
          <Field label={isKo ? '위치' : 'Location'}>
            <select value={locationId} onChange={event => setLocationId(event.target.value)} className={inputClass}><option value="">{isKo ? '선택' : 'Select'}</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
          </Field>
          <Field label={isKo ? '분류' : 'Category'}>
            <select value={categoryId} onChange={event => setCategoryId(event.target.value)} className={inputClass}><option value="">{isKo ? '선택' : 'Select'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          </Field>
          <Field label={isKo ? '이메일 설명' : 'Email Description'} className="md:col-span-2">
            <input value={description} onChange={event => setDescription(event.target.value)} className={inputClass} placeholder="Office Supplies" />
          </Field>
          <Field label={isKo ? '결제수단' : 'Payment Method'}>
            <select value={paymentMethodId} onChange={event => {
              const nextId = event.target.value
              setPaymentMethodId(nextId)
              const method = paymentMethods.find(value => value.id === nextId)
              const last4 = method?.label.match(/(\d{4})(?!.*\d)/)?.[1]
              if (last4) setCardLast4(current => current || last4)
            }} className={inputClass}><option value="">{isKo ? '선택' : 'Select'}</option>{paymentMethods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}</select>
          </Field>
          <Field label={isKo ? '소계' : 'Subtotal'}><MoneyInput value={subtotal} onChange={setSubtotal} /></Field>
          <Field label={isKo ? '세금' : 'Tax'}><MoneyInput value={tax} onChange={setTax} /></Field>
          <Field label={isKo ? '배송비' : 'Shipping'}><MoneyInput value={shipping} onChange={setShipping} /></Field>
          <Field label={isKo ? '합계' : 'Total'}><MoneyInput value={total} onChange={setTotal} /></Field>
          <Field label={isKo ? '통화' : 'Currency'}>
            <select value={currency} onChange={event => setCurrency(event.target.value as Currency)} className={inputClass}><option value="CAD">CAD</option><option value="USD">USD</option></select>
          </Field>
          <Field label={isKo ? '카드 끝 4자리' : 'Card Last 4'}>
            <input inputMode="numeric" maxLength={4} value={cardLast4} onChange={event => setCardLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} className={inputClass} placeholder="9862" />
          </Field>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-line-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">3. {isKo ? '구매 품목' : 'Purchase Lines'}</h2>
            <p className="text-xs text-ink-faint mt-1">{isKo ? '품목 연결은 선택 사항이며 자동 병합되지 않습니다.' : 'Item classification is optional and never merged automatically.'}</p>
          </div>
          <button type="button" onClick={() => setLines(current => [...current, emptyLine()])} className="px-3 py-1.5 text-xs text-ink-muted border border-line rounded-lg hover:bg-pill">+ {isKo ? '품목 추가' : 'Add Line'}</button>
        </div>

        <div className="space-y-4">
          {lines.map((line, index) => {
            const suggestion = suggestedItem(line)
            return (
              <div key={line.key} className="border border-line-soft rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-muted">{isKo ? '품목' : 'Line'} {index + 1}</span>
                  {lines.length > 1 && <button type="button" onClick={() => setLines(current => current.filter(value => value.key !== line.key))} className="text-xs text-ink-faint hover:text-signal-neg">{isKo ? '삭제' : 'Remove'}</button>}
                </div>
                <div className="grid md:grid-cols-4 gap-3">
                  <Field label={isKo ? '원 상품명' : 'Raw Vendor Product Name'} className="md:col-span-2"><input value={line.rawVendorProductName} onChange={event => patchLine(line.key, { rawVendorProductName: event.target.value })} className={inputClass} /></Field>
                  <Field label="SKU / ASIN"><input value={line.vendorSku} onChange={event => patchLine(line.key, { vendorSku: event.target.value })} className={inputClass} /></Field>
                  <Field label={isKo ? '상품 URL' : 'Product URL'}><input type="url" value={line.productUrl} onChange={event => patchLine(line.key, { productUrl: event.target.value })} className={inputClass} /></Field>
                  <Field label={isKo ? '수량' : 'Quantity'}><input type="number" min="0" step="0.001" value={line.quantity} onChange={event => patchLine(line.key, { quantity: event.target.value })} className={inputClass} /></Field>
                  <Field label={isKo ? '구매 당시 단가' : 'Historical Unit Price'}><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={event => patchLine(line.key, { unitPrice: event.target.value })} className={inputClass} /></Field>
                </div>

                {suggestion && (
                  <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <span className="text-xs text-ink">{isKo ? '정확한 업체 SKU 일치:' : 'Exact vendor SKU match:'} <strong>{suggestion.name}</strong></span>
                    <button type="button" onClick={() => patchLine(line.key, { classification: 'existing', itemId: suggestion.id })} className="text-xs font-semibold text-signal-pos hover:underline">{isKo ? '이 품목 연결' : 'Link this Item'}</button>
                  </div>
                )}

                <div className="grid md:grid-cols-3 gap-3">
                  <Field label={isKo ? '카탈로그 분류' : 'Catalog Classification'}>
                    <select value={line.classification} onChange={event => patchLine(line.key, { classification: event.target.value as Classification, itemId: '', newItemName: '' })} className={inputClass}>
                      <option value="unclassified">{isKo ? '미분류로 유지' : 'Leave unclassified'}</option>
                      <option value="existing">{isKo ? '기존 품목 연결' : 'Link existing Item'}</option>
                      <option value="new">{isKo ? '새 품목 생성' : 'Create new Item'}</option>
                    </select>
                  </Field>
                  {line.classification === 'existing' && (
                    <Field label={isKo ? '기존 품목' : 'Existing Item'} className="md:col-span-2">
                      <select value={line.itemId} onChange={event => patchLine(line.key, { itemId: event.target.value })} className={inputClass}><option value="">{isKo ? '선택' : 'Select'}</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    </Field>
                  )}
                  {line.classification === 'new' && (
                    <>
                      <Field label={isKo ? '새 품목명' : 'New Item Name'}><input value={line.newItemName} onChange={event => patchLine(line.key, { newItemName: event.target.value })} className={inputClass} /></Field>
                      <Field label={isKo ? '이미지 URL (선택)' : 'Image URL (optional)'}><input type="url" value={line.newItemImageUrl} onChange={event => patchLine(line.key, { newItemImageUrl: event.target.value })} className={inputClass} /></Field>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-line-soft p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">4. {isKo ? '이메일 미리보기' : 'Email Preview'}</h2>
          <span className="text-xs text-ink-faint">{isKo ? '이번 단계에서는 전송되지 않습니다' : 'Sending is not enabled in this milestone'}</span>
        </div>
        <div className="border border-line-soft rounded-xl overflow-hidden">
          <div className="bg-pill px-4 py-3 text-sm font-semibold text-ink break-words">{emailSubject}</div>
          <pre className="p-4 text-sm text-ink whitespace-pre-wrap font-sans">{emailBody}</pre>
          {attachments.length > 0 && <div className="px-4 py-3 border-t border-line-soft text-xs text-ink-muted">{attachments.length} {isKo ? '개 첨부 예정' : 'attachment(s) ready'}</div>}
        </div>
      </section>

      {error && <div className="bg-red-50 border border-red-200 text-signal-neg text-sm rounded-lg px-4 py-3 whitespace-pre-wrap">{error}</div>}
      {saved && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-ink">
          <div className="font-semibold">{isKo ? '임시저장 완료' : 'Draft saved'}: {saved.purchaseNumber}</div>
          <div className="text-xs text-ink-muted mt-1">ID: {saved.id}</div>
          {saved.warnings.length > 0 && <ul className="list-disc ml-5 mt-2 text-xs text-amber-700">{saved.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={saveDraft} disabled={saving} className="px-5 py-2.5 text-sm text-white bg-ink rounded-lg hover:bg-ink/90 disabled:bg-ink-faint">
          {saving ? (isKo ? '임시저장 중…' : 'Saving Draft...') : (isKo ? '구매 임시저장' : 'Save Purchase Draft')}
        </button>
      </div>
    </div>
  )
}

const inputClass = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20'

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={className}><span className="block text-xs font-semibold text-ink-muted mb-1">{label}</span>{children}</label>
}

function MoneyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="number" min="0" step="0.01" value={value} onChange={event => onChange(event.target.value)} className={inputClass} />
}
