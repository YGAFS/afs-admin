export const PORTAL_TIME_ZONE = 'America/Vancouver'

export type PortalLifecycleStatus = 'pending' | 'active' | 'disabled'

export type PortalAccessState = {
  profileStatus: string | null
  portalStatus: PortalLifecycleStatus | null
  passwordSetupRequired: boolean
  employeeActive: boolean
  endDate: string | null
}

export function portalBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PORTAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Employment access uses is_active as the primary switch. An end_date is an
 * additional inclusive boundary: access is allowed through that Vancouver
 * calendar date and denied beginning the following local date.
 */
export function isEmploymentPortalEligible(
  employee: Pick<PortalAccessState, 'employeeActive' | 'endDate'>,
  businessDate: string,
) {
  return employee.employeeActive && (!employee.endDate || employee.endDate >= businessDate)
}

export function isPortalDataAccessAllowed(state: PortalAccessState, businessDate: string) {
  return state.profileStatus === 'active'
    && state.portalStatus === 'active'
    && state.passwordSetupRequired === false
    && isEmploymentPortalEligible(state, businessDate)
}

export function normalizePortalEmail(value: string) {
  return value.trim().toLowerCase()
}

export function archivedPortalLoginEmail(authUserId: string) {
  return `archived+${authUserId}@afstransco.invalid`
}
