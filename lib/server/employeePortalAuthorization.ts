import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

export type EmployeePortalEmployee = {
  id: string
  name: string
  company_id: string
  team: string | null
  position: string | null
  start_date: string | null
  end_date: string | null
  vacation_allowance: number
  uses_accrual: boolean
  is_exempt: boolean
  probation_end: string | null
}

export type EmployeePortalAuthorization = {
  user: User
  db: SupabaseClient
  employee: EmployeePortalEmployee
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role env vars are not configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function authorizeEmployeePortalRequest(req: NextRequest): Promise<EmployeePortalAuthorization | null> {
  try {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) return null

    const db = serviceClient()
    const { data: auth, error: authError } = await db.auth.getUser(token)
    if (authError || !auth.user?.id) return null

    const { data: profiles, error: profileError } = await db
      .from('user_profiles')
      .select('user_id,status')
      .eq('user_id', auth.user.id)
    if (profileError || profiles?.length !== 1 || profiles[0].status !== 'active') return null

    const { data: links, error: linkError } = await db
      .from('employee_user_links')
      .select('employee_id,user_id')
      .eq('user_id', auth.user.id)
    if (linkError || links?.length !== 1 || links[0].user_id !== auth.user.id || !links[0].employee_id) return null

    const { data: employees, error: employeeError } = await db
      .from('employees')
      .select('id,name,company_id,team,position,start_date,end_date,vacation_allowance,uses_accrual,is_exempt,probation_end')
      .eq('id', links[0].employee_id)
    if (employeeError || employees?.length !== 1 || !employees[0].company_id) return null

    return { user: auth.user, db, employee: employees[0] as EmployeePortalEmployee }
  } catch {
    return null
  }
}

export function portalJsonError(message: string, status: number) {
  return Response.json({ error: message }, { status })
}
