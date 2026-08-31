import assert from 'node:assert/strict'
import { calculatePto, leaveCodeDays, type PtoLeaveEntryInput } from '../lib/hr/pto.ts'

assert.equal(leaveCodeDays('L'), 1)
assert.equal(leaveCodeDays('L1'), 0.5)
assert.equal(leaveCodeDays('L2'), 0.5)
assert.equal(leaveCodeDays('L3'), 1)
assert.equal(leaveCodeDays('S'), 1)
assert.equal(leaveCodeDays('S1'), 0.5)
assert.equal(leaveCodeDays('S2'), 0.5)
assert.equal(leaveCodeDays('S3'), 1)

const pilotEntries: PtoLeaveEntryInput[] = [
  { date: '2026-01-16', leaveCode: 'S2', hours: null },
  { date: '2026-01-19', leaveCode: 'S', hours: null },
  { date: '2026-02-06', leaveCode: 'S', hours: null },
  { date: '2026-02-09', leaveCode: 'S', hours: null },
  { date: '2026-02-10', leaveCode: 'S', hours: null },
  { date: '2026-02-11', leaveCode: 'S1', hours: null },
  { date: '2026-06-30', leaveCode: 'L', hours: null },
  { date: '2026-11-09', leaveCode: 'L', hours: null },
]

const pilot = calculatePto({
  employee: {
    vacationAllowance: 10,
    usesAccrual: true,
    isExempt: false,
    startDate: '2025-10-01',
    endDate: null,
  },
  leaveEntries: pilotEntries,
  year: 2026,
  asOfDate: '2026-08-28',
})
assert.equal(pilot.vacation.accrued, 9.07)
assert.equal(pilot.vacation.used, 1)
assert.equal(pilot.vacation.remaining, 8.07)
assert.equal(pilot.sick.used, 5)
assert.equal(pilot.sick.paidUsed, 5)
assert.equal(pilot.sick.unpaidUsed, 0)
assert.equal(pilot.sick.remaining, 0)
assert.equal(pilot.sick.alert, false)
assert.equal(pilot.vacation.carryIn, 0)

function entriesForPriorPeriod(used: number): PtoLeaveEntryInput[] {
  return Array.from({ length: used }, (_, index) => ({ date: `2025-${String(index + 1).padStart(2, '0')}-01`, leaveCode: 'L' }))
}

assert.equal(calculatePto({
  employee: { vacationAllowance: 10, usesAccrual: true, isExempt: false, startDate: '2024-01-01', endDate: null },
  leaveEntries: entriesForPriorPeriod(10), year: 2026, asOfDate: '2026-08-28',
}).vacation.carryIn, 5)
assert.equal(calculatePto({
  employee: { vacationAllowance: 10, usesAccrual: true, isExempt: false, startDate: '2024-01-01', endDate: null },
  leaveEntries: entriesForPriorPeriod(11), year: 2026, asOfDate: '2026-08-28',
}).vacation.carryIn, 4)
assert.equal(calculatePto({
  employee: { vacationAllowance: 10, usesAccrual: true, isExempt: false, startDate: '2024-01-01', endDate: null },
  leaveEntries: entriesForPriorPeriod(7), year: 2026, asOfDate: '2026-08-28',
}).vacation.carryIn, 5)

console.log('Employee Portal PTO tests passed')
