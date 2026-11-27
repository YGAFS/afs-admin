'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth, useLocale } from '../providers'

const WAREHOUSING_URL = 'https://warehousing.afstransco.com'

function initialsFor(email: string) {
  const localPart = email.split('@')[0]?.replace(/[^a-zA-Z0-9]+/g, ' ').trim() ?? ''
  const parts = localPart.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return localPart.slice(0, 2).toUpperCase() || '?'
}

export default function AccountMenu() {
  const { user, allowedSections, isSuperAdmin, canAccessWarehousing } = useAuth()
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!user?.email) return null

  const accountLabel = locale === 'ko' ? '현재 로그인 계정' : 'Signed-in account'
  const hrLabel = 'AFS HR'
  const utilityLabel = 'AFS Utility'
  const warehousingLabel = 'AFS Warehousing'
  const canAccessHr = isSuperAdmin || allowedSections === null || Boolean(allowedSections?.includes('hr'))
  const canAccessUtility = isSuperAdmin || allowedSections === null || Boolean(allowedSections?.includes('utilities'))

  return (
    <div ref={menuRef} className="fixed top-4 right-8 z-[60]">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex h-9 min-w-9 items-center justify-center rounded-full bg-[#111318] px-2 text-xs font-bold text-white shadow-sm ring-1 ring-white/80 transition-colors hover:bg-[#2a2d33] focus:outline-none focus:ring-2 focus:ring-ink focus:ring-offset-2"
        title={user.email}
        aria-label={`${accountLabel}: ${user.email}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initialsFor(user.email)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-xl"
        >
          <div className="border-b border-line-soft px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{accountLabel}</p>
            <p className="mt-1 truncate text-sm font-medium text-ink" title={user.email}>{user.email}</p>
          </div>
          {canAccessHr && (
            <a
              href="/hr"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:bg-pill hover:text-ink"
            >
              <svg className="h-4 w-4 text-ink-faint" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <rect x="3" y="4" width="14" height="13" rx="2" />
                <path strokeLinecap="round" d="M6 2v4M14 2v4M3 8h14M6.5 11h.01M10 11h.01M13.5 11h.01M6.5 14h.01M10 14h.01" />
              </svg>
              {hrLabel}
            </a>
          )}
          {canAccessUtility && (
            <a
              href="/utilities"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:bg-pill hover:text-ink"
            >
              <svg className="h-4 w-4 text-ink-faint" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M11 0L3 11h5l-1 9 8-11h-5l1-9z" />
              </svg>
              {utilityLabel}
            </a>
          )}
          {(canAccessUtility && canAccessWarehousing) && <div className="mx-4 border-t border-line-soft" />}
          {canAccessWarehousing && (
            <a
              href={WAREHOUSING_URL}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:bg-pill hover:text-ink"
            >
              <svg className="h-4 w-4 text-ink-faint" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 17h14M4 17V7l6-4 6 4v10M7 17v-4h6v4M7 9h.01M10 9h.01M13 9h.01" />
              </svg>
              {warehousingLabel}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
