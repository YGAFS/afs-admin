import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
)

/** Append one row to the audit trail. Called alongside every status-changing
 * mutation and every PO-field edit, matching this app's "app enforces the
 * workflow" convention (no DB triggers encode business rules). */
export async function logActivity(purchaseRequestId: string, actorEmail: string, action: string, detail?: string) {
  await supabase.from('purchase_request_activity').insert({
    purchase_request_id: purchaseRequestId,
    actor_email: actorEmail,
    action,
    detail: detail ?? null,
  })
}
