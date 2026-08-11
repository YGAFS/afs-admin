'use client'

export default function UtilityShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">Utility &amp; Vendor Management</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Overview of utility bills and vendor information across all companies and locations.
        </p>
      </div>

      {/* Content — children manage their own scroll */}
      <div className="flex-1 overflow-hidden bg-gray-50">
        {children}
      </div>
    </div>
  )
}
