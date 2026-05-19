'use client'

import { useLocale } from '@/app/providers'
import { t, type Locale } from '@/lib/i18n'

export default function AdminPage() {
  const { locale, setLocale } = useLocale()

  const languages: { code: Locale; label: string; flag: string }[] = [
    { code: 'en', label: t('settings.lang.en', locale), flag: '🇺🇸' },
    { code: 'ko', label: t('settings.lang.ko', locale), flag: '🇰🇷' },
  ]

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-bold text-gray-800 mb-1">{t('settings.title', locale)}</h1>
      <p className="text-sm text-gray-400 mb-6">{t('nav.admin', locale)}</p>

      <div className="bg-white rounded-xl shadow border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-0.5">{t('settings.language', locale)}</h2>
        <p className="text-xs text-gray-400 mb-4">{t('settings.language.desc', locale)}</p>
        <div className="flex gap-3">
          {languages.map(lang => (
            <button
              key={lang.code}
              onClick={() => setLocale(lang.code)}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                locale === lang.code
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span className="text-lg">{lang.flag}</span>
              {lang.label}
              {locale === lang.code && <span className="ml-1 text-blue-500">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
