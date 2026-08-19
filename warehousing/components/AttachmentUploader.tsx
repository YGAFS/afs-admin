'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { Attachment } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

const BUCKET = 'purchase-attachments'

interface Props {
  purchaseRequestId: string
  fileType: 'photo' | 'receipt'
  label: string
  editable: boolean
  uploadedBy: string
}

export default function AttachmentUploader({ purchaseRequestId, fileType, label, editable, uploadedBy }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [purchaseRequestId, fileType])

  async function load() {
    const { data } = await supabase
      .from('purchase_request_attachments')
      .select('*')
      .eq('purchase_request_id', purchaseRequestId)
      .eq('file_type', fileType)
      .order('created_at', { ascending: false })
    const rows = (data as Attachment[]) ?? []
    setAttachments(rows)

    const entries = await Promise.all(rows.map(async r => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 60 * 10)
      return [r.id, signed?.signedUrl ?? ''] as const
    }))
    setUrls(Object.fromEntries(entries))
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)

    const path = `${purchaseRequestId}/${crypto.randomUUID()}-${file.name}`
    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file)
    if (uploadErr) {
      setError(uploadErr.message)
      setUploading(false)
      return
    }

    await supabase.from('purchase_request_attachments').insert({
      purchase_request_id: purchaseRequestId,
      storage_path: path,
      file_name: file.name,
      file_type: fileType,
      uploaded_by: uploadedBy,
    })

    setUploading(false)
    e.target.value = ''
    load()
  }

  async function handleDelete(a: Attachment) {
    await supabase.storage.from(BUCKET).remove([a.storage_path])
    await supabase.from('purchase_request_attachments').delete().eq('id', a.id)
    load()
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-ink-muted">{label}</label>
      {attachments.length === 0 ? (
        <p className="text-sm text-ink-faint">첨부된 파일이 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map(a => (
            <li key={a.id} className="flex items-center justify-between text-sm">
              <a href={urls[a.id] || '#'} target="_blank" rel="noreferrer" className="text-ink hover:underline truncate">
                📎 {a.file_name}
              </a>
              {editable && (
                <button onClick={() => handleDelete(a)} className="text-xs text-ink-faint hover:text-signal-neg shrink-0 ml-2">
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div>
          <input type="file" onChange={handleUpload} disabled={uploading} className="text-sm text-ink-muted" />
          {uploading && <p className="text-xs text-ink-faint">업로드 중…</p>}
          {error && <p className="text-xs text-signal-neg">{error}</p>}
        </div>
      )}
    </div>
  )
}
