import EmployeeAccountsClient from './EmployeeAccountsClient'
import { employeeAccountManagementEnabled } from '@/lib/server/supabaseServer'

export const dynamic = 'force-dynamic'

export default function EmployeeAccountsPage() {
  const enabled = employeeAccountManagementEnabled()
  if (!enabled) return <div className="max-w-3xl p-6 md:p-10"><h1 className="text-2xl font-bold">Employee Portal Accounts</h1><div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Account management is installed but disabled. Set <code>EMPLOYEE_PORTAL_ACCOUNT_MANAGEMENT_ENABLED=true</code> only for an approved pilot environment.</div></div>
  return <EmployeeAccountsClient />
}
