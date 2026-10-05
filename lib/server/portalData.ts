import { type SupabaseClient } from '@supabase/supabase-js'
import { calculatePto, type PtoLeaveEntryInput } from '@/lib/hr/pto'
import { portalBusinessDate } from '@/lib/portalAccess'
import { type PortalEmployee } from '@/lib/server/portalAuthorization'

const RELEVANT_CODES = new Set(['L', 'L1', 'L2', 'L3', 'S', 'S1', 'S2', 'S3', 'W', 'T', 'T1', 'T2', 'T3'])

export function currentPortalYear() {
  return Number(portalBusinessDate().slice(0, 4))
}

export function validPortalYear(value: string | null) {
  if (!value || !/^\d{4}$/.test(value)) return null
  const year = Number(value)
  return Number.isInteger(year) && year >= 2000 && year <= currentPortalYear() + 1 ? year : null
}

export async function loadPortalPtoData(
  db: SupabaseClient,
  employee: PortalEmployee,
  year: number,
) {
  const currentDate = portalBusinessDate()
  const effectiveAsOf = employee.end_date && employee.end_date < currentDate
    ? employee.end_date
    : currentDate

  const [companyResult, leaveResult] = await Promise.all([
    db.from('companies').select('id,code,name').eq('id', employee.company_id).maybeSingle(),
    db.from('leave_entries')
      .select('id,date,leave_code,hours')
      .eq('employee_id', employee.id)
      .order('date', { ascending: true }),
  ])
  if (companyResult.error || !companyResult.data) throw new Error('Failed to load employee company')
  if (leaveResult.error) throw new Error('Failed to load employee leave history')

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

  return {
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
    leaveHistory: (leaveResult.data ?? [])
      .filter(entry => entry.date.startsWith(`${year}-`) && RELEVANT_CODES.has(entry.leave_code))
      .map(entry => ({
        id: entry.id,
        date: entry.date,
        code: entry.leave_code,
        days: ['L1', 'L2', 'S1', 'S2', 'T1', 'T2'].includes(entry.leave_code) ? 0.5 : 1,
        hours: entry.hours,
      })),
    policySummary: {
      paidSickAllowance: 5,
      unpaidSickAllowance: 3,
      sickEligibilityDays: 90,
      sickAlertThreshold: 8,
      dayHours: 8,
      hourlyLeaveUsesLegacyDayWeighting: true,
    },
  }
}
