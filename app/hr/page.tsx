'use client'

import { useRouter } from 'next/navigation'
import HrSummaryCards from './components/HrSummaryCards'
import EmployeeSearch from './components/EmployeeSearch'
import { useLocale } from '@/app/providers'
import { t } from '@/lib/i18n'

export default function HrPage() {
  const router = useRouter()
  const { locale } = useLocale()

  const COMPANIES: { slug: string; labelKey: string; color: string; disabled?: boolean }[] = [
    { slug: 'afs', labelKey: 'hr.afs_attendance', color: 'bg-white border border-line text-blue-600 hover:bg-pill' },
    { slug: 'tnt', labelKey: 'hr.tnt_attendance', color: 'bg-white border border-line text-amber-600 hover:bg-pill' },
    { slug: 'zfs', labelKey: 'hr.zfs_attendance',  color: 'bg-white border border-line text-emerald-600 hover:bg-pill' },
  ]

  return (
    <div className="min-h-screen bg-pill">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-semibold text-ink">{t('hr.title', locale)}</h1>
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

        <div className="mt-8 bg-white border border-line rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-ink">{t('hr.employee_search', locale)}</h2>
          </div>
          <EmployeeSearch />
        </div>
      </div>
    </div>
  )
}
