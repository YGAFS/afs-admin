// Backward-compatible exports for existing Employee Portal routes. The v2
// implementation uses the caller's JWT/RLS context for Employee/PTO reads.
export {
  authorizePortalRequest as authorizeEmployeePortalRequest,
  portalJsonError,
} from '@/lib/server/portalAuthorization'

export type {
  PortalAuthorization as EmployeePortalAuthorization,
  PortalEmployee as EmployeePortalEmployee,
} from '@/lib/server/portalAuthorization'
