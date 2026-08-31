import { NextRequest } from 'next/server'
import { calculatePto, type PtoLeaveEntryInput } from '@/lib/hr/pto'
import { authorizeEmployeePortalRequest, portalJsonError } from '@/lib/server/employeePortalAuthorization'

const ALLOWED_QUERY_PARAMS = new Set(['year'])
const RELEVANT_CODES = new Set(['L', 'L1', 'L2', 'L3', 'S', 'S1', 'S2', 'S3'])

function currentYear() {
  return new Date().getFullYear()
}

function todayIso() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function parseYear(req: NextRequest) {
  const keys = Array.from(req.nextUrl.searchParams.keys())
  if (keys.some(key => !ALLOWED_QUERY_PARAMS.has(key))) return null
  const raw = req.nextUrl.searchParams.get('year')
  if (!raw || !/^\d{4}$/.test(raw)) return null
  const year = Number(raw)
  return Number.isInteger(year) && year >= 2000 && year <= currentYear() + 1 ? year : null
}

export async function GET(req: NextRequest) {
  const year = parseYear(req)
  if (year === null) return portalJsonError('Invalid year', 400)

  const auth = await authorizeEmployeePortalRequest(req)
  if (!auth) return portalJsonError('Employee portal access denied', 403)

  const { employee, db } = auth
  // `year` controls the returned history. EmployeeSearch's balance is as of
  // today (or the employee's end date), so a future leave row cannot reduce it.
  const currentDate = todayIso()
  const effectiveAsOf = employee.end_date && employee.end_date < currentDate ? employee.end_date : currentDate

  const [companyResult, leaveResult] = await Promise.all([
    db.from('companies').select('id,code,name').eq('id', employee.company_id).maybeSingle(),
    db.from('leave_entries')
      .select('id,date,leave_code,hours')
      .eq('employee_id', employee.id)
      .order('date', { ascending: true }),
  ])
  if (companyResult.error || !companyResult.data) return portalJsonError('Failed to load employee company', 500)
  if (leaveResult.error) return portalJsonError('Failed to load employee leave history', 500)

  const leaveEntries: PtoLeaveEntryInput[] = (leaveResult.data ?? []).map(entry => ({
    id: entry.id,
    date: entry.date,
    leaveCode: entry.leave_code,
    hours: entry.hours,
  }))
  const pto = calculatePto({
    employee: {
      vacationAllowance: Number(employee.vacation_allowance),
      usesAccrual: employee.uses_accrual,
      isExempt: employee.is_exempt,
      startDate: employee.start_date,
      endDate: employee.end_date,
    },
    leaveEntries,
    year,
    asOfDate: effectiveAsOf,
  })

  const leaveHistory = (leaveResult.data ?? [])
    .filter(entry => entry.date.startsWith(`${year}-`) && RELEVANT_CODES.has(entry.leave_code))
    .map(entry => ({
      id: entry.id,
      date: entry.date,
      code: entry.leave_code,
      days: entry.leave_code === 'L1' || entry.leave_code === 'L2' || entry.leave_code === 'S1' || entry.leave_code === 'S2' ? 0.5 : 1,
      hours: entry.hours,
    }))

  return Response.json({
    employee: {
      id: employee.id,
      name: employee.name,
      company: companyResult.data,
      team: employee.team,
      position: employee.position,
      startDate: employee.start_date,
      endDate: employee.end_date,
    },
    year,
    vacation: pto.vacation,
    sick: pto.sick,
    leaveHistory,
    policySummary: {
      vacationCarryoverLimit: 5,
      paidSickAllowance: 5,
      sickAlertThreshold: 8,
      dayHours: 8,
      hourlyLeaveUsesLegacyDayWeighting: true,
    },
  })
}
