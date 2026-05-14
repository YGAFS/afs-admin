'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import HrSummaryCards from './components/HrSummaryCards'
import EmployeeSearch from './components/EmployeeSearch'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const COMPANIES = [
  { slug: 'afs', label: 'AFS 근태',  color: 'bg-blue-600  hover:bg-blue-700  text-white' },
  { slug: 'tnt', label: 'TNT 근태',  color: 'bg-green-600 hover:bg-green-700 text-white' },
  { slug: 'zfs', label: 'ZFS 준비중', color: 'bg-gray-200  text-gray-400 cursor-not-allowed', disabled: true },
]

export default function HrPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">HR Dashboard</h1>
          <div className="flex gap-2">
            {COMPANIES.map(c => (
              <button key={c.slug}
                onClick={() => !c.disabled && router.push(`/hr/${c.slug}`)}
                disabled={c.disabled}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${c.color}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* 요약 카드 */}
        <HrSummaryCards />

        {/* 직원 검색 */}
        <div className="mt-8 bg-white border border-gray-300 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-gray-900">직원 검색</h2>
          </div>
          <EmployeeSearch />
        </div>
      </div>
    </div>
  )
}
