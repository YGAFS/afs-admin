export type Locale = 'en' | 'ko'

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Sidebar
    'nav.hr':            'HR Calendar',
    'nav.licenses':      'Subscriptions',
    'nav.assets':        'IT Assets',
    'nav.supplies':      'Coffee Order',
    'nav.admin':         'Admin',
    'sidebar.title':     'AFS Admin',
    'sidebar.collapse':  'Collapse',
    'sidebar.expand':    'Expand',
    // Auth
    'auth.logout':       'Log out',
    'auth.login':        'Sign in',
    'auth.email':        'Email',
    'auth.password':     'Password',
    'auth.signing_in':   'Signing in…',
    'auth.error':        'Invalid email or password',
    'auth.welcome':      'Welcome back',
    'auth.subtitle':     'Sign in to AFS Admin',
  },
  ko: {
    // Sidebar
    'nav.hr':            'HR 근태 캘린더',
    'nav.licenses':      '구독 관리',
    'nav.assets':        'IT 자산',
    'nav.supplies':      'Coffee Order',
    'nav.admin':         'Admin',
    'sidebar.title':     'AFS Admin',
    'sidebar.collapse':  '접기',
    'sidebar.expand':    '펼치기',
    // Auth
    'auth.logout':       '로그아웃',
    'auth.login':        '로그인',
    'auth.email':        '이메일',
    'auth.password':     '비밀번호',
    'auth.signing_in':   '로그인 중…',
    'auth.error':        '이메일 또는 비밀번호가 올바르지 않습니다',
    'auth.welcome':      '다시 오셨군요',
    'auth.subtitle':     'AFS Admin에 로그인하세요',
  },
}

/** Returns translated string; falls back to English, then the key itself. */
export function t(key: string, locale: Locale): string {
  return translations[locale]?.[key] ?? translations['en']?.[key] ?? key
}
