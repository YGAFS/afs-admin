export type PtoEmployeeInput = {
  vacationAllowance: number
  usesAccrual: boolean
  isExempt: boolean
  startDate: string | null
  endDate: string | null
}

export type PtoLeaveEntryInput = {
  id?: string
  date: string
  leaveCode: string
  hours?: number | null
}

export type AnniversaryPeriod = {
  periodStart: string
  periodEnd: string
  periodYear: number
  isCurrent: boolean
}

export type VacationPtoResult = {
  available: boolean
  entitlement: number | null
  accrued: number | null
  carryIn: number | null
  used: number | null
  remaining: number | null
  excessCarryover: number | null
  usesAccrual: boolean
  asOfDate: string
}

export type SickPtoResult = {
  allowance: 5
  used: number
  paidUsed: number
  unpaidUsed: number
  remaining: number
  alert: boolean
}

export type PtoResult = {
  vacation: VacationPtoResult
  sick: SickPtoResult
}

export const PTO_POLICY = {
  carryoverLimit: 5,
  paidSickAllowance: 5,
  sickAlertThreshold: 8,
  dayHours: 8,
} as const

const VACATION_CODES = new Set(['L', 'L1', 'L2', 'L3'])
const SICK_CODES = new Set(['S', 'S1', 'S2', 'S3'])
const HALF_DAY_CODES = new Set(['L1', 'L2', 'S1', 'S2'])

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toIsoDate(value: Date) {
  return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate())
}

function addYears(value: Date, years: number) {
  const result = new Date(value)
  result.setFullYear(value.getFullYear() + years)
  return result
}

export function leaveCodeDays(leaveCode: string) {
  return HALF_DAY_CODES.has(leaveCode) ? 0.5 : 1
}

export function isVacationCode(leaveCode: string) {
  return VACATION_CODES.has(leaveCode)
}

export function isSickCode(leaveCode: string) {
  return SICK_CODES.has(leaveCode)
}

export function getEffectiveAsOfDate(employee: Pick<PtoEmployeeInput, 'endDate'>, asOfDate: string) {
  if (!employee.endDate) return asOfDate
  return employee.endDate < asOfDate ? employee.endDate : asOfDate
}

export function getAnniversaryPeriods(startDate: string, asOfDate: string): AnniversaryPeriod[] {
  const start = parseIsoDate(startDate)
  const asOf = parseIsoDate(asOfDate)
  const periods: AnniversaryPeriod[] = []

  for (let year = 0; ; year++) {
    const periodStart = addYears(start, year)
    if (periodStart > asOf) break
    const periodEnd = addYears(start, year + 1)
    periodEnd.setDate(periodEnd.getDate() - 1)
    periods.push({
      periodStart: toIsoDate(periodStart),
      periodEnd: toIsoDate(periodEnd),
      periodYear: year + 1,
      isCurrent: false,
    })
  }

  if (periods.length) periods[periods.length - 1].isCurrent = true
  return periods
}

function elapsedAccrual(allowance: number, periodStart: string, asOfDate: string) {
  const daysElapsed = Math.floor((parseIsoDate(asOfDate).getTime() - parseIsoDate(periodStart).getTime()) / 86400000)
  return round2(Math.max(0, daysElapsed) / 365 * allowance)
}

export function calculateVacation(
  employee: PtoEmployeeInput,
  leaveEntries: PtoLeaveEntryInput[],
  requestedAsOfDate: string,
): VacationPtoResult {
  const asOfDate = getEffectiveAsOfDate(employee, requestedAsOfDate)

  if (employee.isExempt) {
    return {
      available: false,
      entitlement: null,
      accrued: null,
      carryIn: null,
      used: null,
      remaining: null,
      excessCarryover: null,
      usesAccrual: employee.usesAccrual,
      asOfDate,
    }
  }

  // This preserves EmployeeSearch's current detailed-panel behavior: its
  // non-accrual branch receives periodUsed=0 from loadStats.
  if (!employee.usesAccrual) {
    return {
      available: true,
      entitlement: employee.vacationAllowance,
      accrued: employee.vacationAllowance,
      carryIn: 0,
      used: 0,
      remaining: employee.vacationAllowance,
      excessCarryover: 0,
      usesAccrual: false,
      asOfDate,
    }
  }

  if (!employee.startDate || employee.startDate > asOfDate) {
    return {
      available: true,
      entitlement: employee.vacationAllowance,
      accrued: null,
      carryIn: null,
      used: null,
      remaining: null,
      excessCarryover: null,
      usesAccrual: true,
      asOfDate,
    }
  }

  const periods = getAnniversaryPeriods(employee.startDate, asOfDate)
  let carryIn = 0
  let excessCarryover = 0
  let current: { accrued: number; used: number; remaining: number; carryIn: number } | null = null

  for (const period of periods) {
    const end = period.isCurrent ? asOfDate : period.periodEnd
    const used = round2(leaveEntries
      .filter(entry => isVacationCode(entry.leaveCode) && entry.date >= period.periodStart && entry.date <= end)
      .reduce((sum, entry) => sum + leaveCodeDays(entry.leaveCode), 0))
    const accrued = period.isCurrent
      ? elapsedAccrual(employee.vacationAllowance, period.periodStart, asOfDate)
      : employee.vacationAllowance
    const remaining = Math.max(0, round2(accrued + carryIn - used))

    if (period.isCurrent) {
      current = { accrued, used, remaining, carryIn }
      break
    }

    excessCarryover = Math.max(0, round2(remaining - PTO_POLICY.carryoverLimit))
    carryIn = Math.min(PTO_POLICY.carryoverLimit, remaining)
  }

  if (!current) {
    return {
      available: true,
      entitlement: employee.vacationAllowance,
      accrued: null,
      carryIn: null,
      used: null,
      remaining: null,
      excessCarryover: null,
      usesAccrual: true,
      asOfDate,
    }
  }

  return {
    available: true,
    entitlement: employee.vacationAllowance,
    accrued: current.accrued,
    carryIn: current.carryIn,
    used: current.used,
    remaining: current.remaining,
    excessCarryover,
    usesAccrual: true,
    asOfDate,
  }
}

export function calculateSick(year: number, leaveEntries: PtoLeaveEntryInput[]): SickPtoResult {
  const used = round2(leaveEntries
    .filter(entry => entry.date.startsWith(`${year}-`) && isSickCode(entry.leaveCode))
    .reduce((sum, entry) => sum + leaveCodeDays(entry.leaveCode), 0))
  const paidUsed = Math.min(used, PTO_POLICY.paidSickAllowance)

  return {
    allowance: PTO_POLICY.paidSickAllowance,
    used,
    paidUsed,
    unpaidUsed: Math.max(0, round2(used - PTO_POLICY.paidSickAllowance)),
    remaining: Math.max(0, round2(PTO_POLICY.paidSickAllowance - paidUsed)),
    alert: used > PTO_POLICY.sickAlertThreshold,
  }
}

export function calculatePto(input: {
  employee: PtoEmployeeInput
  leaveEntries: PtoLeaveEntryInput[]
  year: number
  asOfDate: string
}): PtoResult {
  return {
    vacation: calculateVacation(input.employee, input.leaveEntries, input.asOfDate),
    sick: calculateSick(input.year, input.leaveEntries),
  }
}
