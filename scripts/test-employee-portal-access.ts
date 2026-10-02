import assert from 'node:assert/strict'
import { isPortalDataAccessAllowed, isEmploymentPortalEligible } from '../lib/portalAccess.ts'
import { resolvePortalAuthorization } from '../lib/server/portalAuthorization.ts'
import { employeeAccountManagementEnabled, employeePortalV2SchemaEnabled } from '../lib/server/supabaseServer.ts'

const originalSchemaFlag = process.env.EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED
const originalAccountFlag = process.env.EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED
delete process.env.EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED
delete process.env.EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED
assert.equal(employeePortalV2SchemaEnabled(), false)
assert.equal(employeeAccountManagementEnabled(), false)
process.env.EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED = 'true'
assert.equal(employeeAccountManagementEnabled(), false)
process.env.EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED = 'true'
assert.equal(employeePortalV2SchemaEnabled(), true)
assert.equal(employeeAccountManagementEnabled(), true)
if (originalSchemaFlag === undefined) delete process.env.EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED
else process.env.EMPLOYEE_PORTAL_V2_SCHEMA_ENABLED = originalSchemaFlag
if (originalAccountFlag === undefined) delete process.env.EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED
else process.env.EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED = originalAccountFlag

const businessDate = '2026-09-29'
const base = {
  profileStatus: 'active',
  portalStatus: 'active' as const,
  passwordSetupRequired: false,
  employeeActive: true,
  endDate: null,
}

assert.equal(isPortalDataAccessAllowed(base, businessDate), true)
assert.equal(isPortalDataAccessAllowed({ ...base, employeeActive: false }, businessDate), false)
assert.equal(isPortalDataAccessAllowed({ ...base, passwordSetupRequired: true }, businessDate), false)
assert.equal(isPortalDataAccessAllowed({ ...base, portalStatus: 'disabled' }, businessDate), false)
assert.equal(isEmploymentPortalEligible({ employeeActive: true, endDate: businessDate }, businessDate), true)
assert.equal(isEmploymentPortalEligible({ employeeActive: true, endDate: '2026-09-28' }, businessDate), false)
assert.equal(isEmploymentPortalEligible({ employeeActive: false, endDate: '2026-12-31' }, businessDate), false)

type State = {
  profileStatus: string
  portalStatus: 'pending' | 'active' | 'disabled'
  passwordSetupRequired: boolean
  employeeActive: boolean
  endDate: string | null
}

function fakeDb(state: State) {
  return {
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          if (table === 'user_profiles') return { data: { status: state.profileStatus }, error: null }
          if (table === 'employee_user_links') return { data: { employee_id: 'employee-1', user_id: 'user-1', portal_status: state.portalStatus, password_setup_required: state.passwordSetupRequired }, error: null }
          if (table === 'employees') return { data: { id: 'employee-1', name: 'Pilot', company_id: 'company-1', team: null, position: null, start_date: '2026-01-01', end_date: state.endDate, vacation_allowance: 10, uses_accrual: true, is_exempt: false, probation_end: null, is_active: state.employeeActive, work_email: null }, error: null }
          return { data: null, error: new Error('Unexpected table') }
        },
      }
    },
  }
}

const state: State = { profileStatus: 'active', portalStatus: 'active', passwordSetupRequired: false, employeeActive: true, endDate: null }
const sameAuthenticatedSession = { user: { id: 'user-1' }, db: fakeDb(state) }

// Baseline: an already logged-in employee can make a server-authorized request.
assert.ok(await resolvePortalAuthorization(sameAuthenticatedSession as never, businessDate))

// Reset Login: the exact same access token/session is denied on its next server request.
state.passwordSetupRequired = true
assert.equal(await resolvePortalAuthorization(sameAuthenticatedSession as never, businessDate), null)

// Disable Account: again, the existing session is denied by current server state.
state.passwordSetupRequired = false
state.portalStatus = 'disabled'
state.profileStatus = 'inactive'
assert.equal(await resolvePortalAuthorization(sameAuthenticatedSession as never, businessDate), null)

console.log('Employee Portal lifecycle and stale-session authorization tests passed')
