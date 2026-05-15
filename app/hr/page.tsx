'use client'

import { useRouter } from 'next/navigation'
import HrSummaryCards from './components/HrSummaryCards'
import EmployeeSearch from './components/EmployeeSearch'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

export default function HrPage() {
  const router = useRouter()
  const { locale } = useLocale()

  const COMPANIES = [
    { slug: 'afs', labelKey: 'hr.afs_attendance', color: 'bg-blue-600  hover:bg-blue-700  text-white' },
    { slug: 'tnt', labelKey: 'hr.tnt_attendance', color: 'bg-green-600 hover:bg-green-700 text-white' },
    { slug: 'zfs', labelKey: 'hr.zfs_coming_soon', color: 'bg-gray-200  text-gray-400 cursor-not-allowed', disabled: true },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t('hr.title', locale)}</h1>
          <div className="flex gap-2">
            {COMPANIES.map(c => (
              <button key={c.slug}
                onClick={() => !c.disabled && router.push(`/hr/${c.slug}`)}
                disabled={c.disabled}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${c.color}`}>
                {t(c.labelKey, locale)}
              </button>
            ))}
          </div>
        </div>

        <HrSummaryCards />

        <div className="mt-8 bg-white border border-gray-300 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-gray-900">{t('hr.employee_search', locale)}</h2>
          </div>
          <EmployeeSearch />
        </div>
      </div>
    </div>
  )
}
