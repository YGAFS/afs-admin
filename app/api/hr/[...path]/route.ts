import { NextRequest } from 'next/server'
import { authorizeHrRequest, jsonError } from '@/lib/server/hrAuthorization'

type Params = { params: Promise<{ path: string[] }> }
const tableBySegment = { employees: 'employees', 'leave-entries': 'leave_entries', 'attendance-notes': 'attendance_notes', 'attendance-flags': 'attendance_flags' } as const

async function body(req: NextRequest): Promise<any> { return await req.json().catch(() => null) }
function uuid(value: unknown) { return typeof value === 'string' && value.length > 0 ? value : null }

export async function GET(req: NextRequest, { params }: Params) {
  const parts = (await params).path
  const segment = parts[0]
  const db = segment === 'companies' ? null : tableBySegment[segment as keyof typeof tableBySegment]
  const companyId = uuid(req.nextUrl.searchParams.get('companyId'))
  const employeeId = uuid(req.nextUrl.searchParams.get('employeeId'))
  const auth = await authorizeHrRequest(req, { action: 'read', companyId, employeeId, allowCompanyDiscovery: segment === 'companies', allowAssignedCompanies: segment === 'summary' || (segment === 'employees' && !companyId) })
  if (!auth) return jsonError('Forbidden', 403)
  if (segment === 'companies') {
    let query = auth.db.from('companies').select('*').order('name')
    const code = req.nextUrl.searchParams.get('code')
    if (code) query = query.eq('code', code.toUpperCase())
    const result = await query
    return result.error ? jsonError('Failed to load companies', 500) : Response.json({ data: result.data ?? [] })
  }
  if (segment === 'summary') {
    if (!auth.companyId && !auth.isSuperAdmin && !auth.companyIds.length) return jsonError('Company scope required', 403)
    let employeeQuery = auth.db.from('employees').select('id,vacation_allowance,uses_accrual,is_exempt,employment_type,company_id').eq('is_active', true)
    if (auth.companyId) employeeQuery = employeeQuery.eq('company_id', auth.companyId)
    else if (!auth.isSuperAdmin) employeeQuery = employeeQuery.in('company_id', auth.companyIds)
    const result = await employeeQuery
    if (result.error) return jsonError('Failed to load HR summary', 500)
    const ids = (result.data ?? []).map(x => x.id)
    const entries = ids.length ? await auth.db.from('leave_entries').select('employee_id,leave_code,date').in('employee_id', ids) : { data: [], error: null }
    return entries.error ? jsonError('Failed to load HR summary', 500) : Response.json({ employees: result.data ?? [], entries: entries.data ?? [] })
  }
  if (segment === 'attendance') {
    const { data: employees, error: employeesError } = await auth.db.from('employees').select('*').eq('company_id', auth.companyId!).or(`end_date.is.null,end_date.gte.${req.nextUrl.searchParams.get('first')}`).or(`start_date.is.null,start_date.lte.${req.nextUrl.searchParams.get('last')}`)
    if (employeesError) return jsonError('Failed to load employees', 500)
    const ids = (employees ?? []).map(x => x.id)
    const range = (field: string) => ids.length ? auth.db.from(field).select('*').in('employee_id', ids).gte('date', req.nextUrl.searchParams.get('first')!).lte('date', req.nextUrl.searchParams.get('last')!) : Promise.resolve({ data: [], error: null })
    const [month, year, prev, prevPrev, notes, flags] = await Promise.all([
      range('leave_entries'), ids.length ? auth.db.from('leave_entries').select('*').in('employee_id', ids).gte('date', `${req.nextUrl.searchParams.get('year')}-01-01`).lte('date', `${req.nextUrl.searchParams.get('year')}-12-31`) : Promise.resolve({ data: [], error: null }),
      ids.length ? auth.db.from('leave_entries').select('*').in('employee_id', ids).gte('date', `${Number(req.nextUrl.searchParams.get('year')) - 1}-01-01`).lte('date', `${Number(req.nextUrl.searchParams.get('year')) - 1}-12-31`) : Promise.resolve({ data: [], error: null }),
      ids.length ? auth.db.from('leave_entries').select('*').in('employee_id', ids).gte('date', `${Number(req.nextUrl.searchParams.get('year')) - 2}-01-01`).lte('date', `${Number(req.nextUrl.searchParams.get('year')) - 2}-12-31`) : Promise.resolve({ data: [], error: null }), range('attendance_notes'), range('attendance_flags'),
    ])
    return Response.json({ employees: employees ?? [], monthEntries: month.data ?? [], yearEntries: year.data ?? [], prevYearEntries: prev.data ?? [], prevPrevYearEntries: prevPrev.data ?? [], notes: notes.data ?? [], flags: flags.data ?? [] })
  }
  if (!db || (!auth.companyId && !auth.isSuperAdmin && !auth.companyIds.length)) return jsonError('Invalid HR read target', 400)
  let query = auth.db.from(db).select('*')
  if (employeeId) query = query.eq('employee_id', employeeId)
  else if (db === 'employees' && auth.companyId) query = query.eq('company_id', auth.companyId)
  else if (db === 'employees' && !auth.isSuperAdmin) query = query.in('company_id', auth.companyIds)
  else {
    if (auth.companyId) {
      const employees = await auth.db.from('employees').select('id').eq('company_id', auth.companyId)
      if (employees.error) return jsonError('Failed to resolve company employees', 500)
      query = query.in('employee_id', (employees.data ?? []).map(x => x.id))
    } else if (!auth.isSuperAdmin) {
      const employees = await auth.db.from('employees').select('id').in('company_id', auth.companyIds)
      if (employees.error) return jsonError('Failed to resolve company employees', 500)
      query = query.in('employee_id', (employees.data ?? []).map(x => x.id))
    }
  }
  const first = req.nextUrl.searchParams.get('first')
  const last = req.nextUrl.searchParams.get('last')
  if (db !== 'employees' && first) query = query.gte('date', first)
  if (db !== 'employees' && last) query = query.lte('date', last)
  const result = await query
  if (result.error) return jsonError('Failed to load HR data', 500)
  if (db === 'employees') {
    const companies = await auth.db.from('companies').select('id,name,code')
    if (companies.error) return jsonError('Failed to load companies', 500)
    const companyById = new Map((companies.data ?? []).map(company => [company.id, company]))
    return Response.json({ data: (result.data ?? []).map(employee => ({ ...employee, companies: companyById.get(employee.company_id) ?? null })) })
  }
  return Response.json({ data: result.data ?? [] })
}

export async function POST(req: NextRequest, { params }: Params) {
  const parts = (await params).path
  const segment = parts[0]
  const input = await body(req)
  const companyId = uuid(input?.company_id) ?? uuid(input?.companyId)
  const employeeId = uuid(input?.employee_id) ?? uuid(input?.employeeId)
  const employeeIds = Array.isArray(input)
    ? input.map(row => uuid(row?.employee_id) ?? uuid(row?.employeeId)).filter((value): value is string => value !== null)
    : undefined
  const auth = await authorizeHrRequest(req, { action: 'write', companyId, employeeId, employeeIds })
  if (!auth) return jsonError('Forbidden', 403)
  const table = tableBySegment[segment as keyof typeof tableBySegment]
  if (!table) return jsonError('Invalid HR write target', 400)
  const conflict = table === 'leave_entries'
    ? 'employee_id,date,leave_code'
    : table === 'attendance_notes'
      ? 'employee_id,date'
      : table === 'attendance_flags'
        ? 'employee_id,date,flag_type'
        : undefined
  const result = conflict
    ? await auth.db.from(table).upsert(input, { onConflict: conflict })
    : await auth.db.from(table).upsert(input)
  return result.error ? jsonError(result.error.message, 400) : Response.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const parts = (await params).path
  const segment = parts[0]
  const input = await body(req)
  const employeeId = uuid(parts[1]) ?? uuid(input?.employee_id)
  const auth = await authorizeHrRequest(req, { action: 'write', employeeId, companyId: uuid(input?.company_id) })
  if (!auth) return jsonError('Forbidden', 403)
  const table = tableBySegment[segment as keyof typeof tableBySegment]
  if (!table || !employeeId) return jsonError('Invalid HR update target', 400)
  const { company_id: _companyId, ...patch } = input ?? {}
  let query = auth.db.from(table).update(patch)
  query = table === 'employees' ? query.eq('id', employeeId) : query.eq('employee_id', employeeId)
  if (input?.date) query = query.eq('date', input.date)
  if (input?.leave_code) query = query.eq('leave_code', input.leave_code)
  if (input?.flag_type) query = query.eq('flag_type', input.flag_type)
  const result = await query
  return result.error ? jsonError(result.error.message, 400) : Response.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const parts = (await params).path
  const segment = parts[0]
  const input = await body(req)
  const employeeIds = Array.isArray(input?.employee_ids)
    ? input.employee_ids.filter((value: unknown): value is string => uuid(value) !== null)
    : []
  const employeeId = uuid(parts[1]) ?? uuid(input?.employee_id) ?? uuid(req.nextUrl.searchParams.get('employeeId'))
  const auth = await authorizeHrRequest(req, { action: 'delete', employeeId, employeeIds: employeeId ? undefined : employeeIds, companyId: uuid(input?.company_id) })
  if (!auth) return jsonError('Forbidden', 403)
  const table = tableBySegment[segment as keyof typeof tableBySegment]
  if (!table) return jsonError('Invalid HR delete target', 400)
  let query = auth.db.from(table).delete()
  if (table === 'employees') {
    if (!employeeId) return jsonError('Employee scope required', 400)
    query = query.eq('id', employeeId)
  }
  else {
    if (employeeId) query = query.eq('employee_id', employeeId)
    else if (employeeIds.length) query = query.in('employee_id', employeeIds)
    else return jsonError('Employee scope required', 400)
    if (input?.date) query = query.eq('date', input.date)
    if (input?.leave_code) query = query.eq('leave_code', input.leave_code)
    if (input?.flag_type) query = query.eq('flag_type', input.flag_type)
  }
  const result = await query
  return result.error ? jsonError(result.error.message, 400) : Response.json({ ok: true })
}
