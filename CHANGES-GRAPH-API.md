# Microsoft Graph API 이메일 전송 연동 — 작업 기록

> 작성일: 2026-07-09  
> 목적: 기존 `mailto:` 방식(Outlook 앱 자동 실행)을 Microsoft Graph API 실제 전송으로 교체

---

## 배경

이메일 리포트 모달에서 **From 발신인 설정이 불가능**한 문제 존재.  
`mailto:` 링크는 브라우저 표준상 `from=` 파라미터를 지원하지 않아  
발신인을 지정할 방법이 없었음.

해결 방향: Microsoft Graph API (`POST /me/sendMail`)를 통해  
특정 Microsoft 계정으로 로그인한 뒤 해당 계정 명의로 직접 이메일 발송.

---

## 구현된 내용

### 1. Azure AD 앱 등록
- **앱 이름**: afs-admin  
- **Client ID**: `afff5bcc-129e-4268-94c3-50fcadc8d61e`  
- **Tenant ID**: `7bb58611-6b4d-46c8-be68-37a94daa91b9`  
- **플랫폼 타입**: SPA (Single-page Application) — PKCE 방식  
- **API 권한**: `Microsoft Graph > Mail.Send` (Delegated)  
- 별도 서버 없이 프론트에서 직접 인증하는 구조 (클라이언트 시크릿 불필요)

### 2. 환경 변수 (`.env.local` + Vercel Production)
```
NEXT_PUBLIC_AZURE_CLIENT_ID=afff5bcc-129e-4268-94c3-50fcadc8d61e
NEXT_PUBLIC_AZURE_TENANT_ID=7bb58611-6b4d-46c8-be68-37a94daa91b9
```

### 3. 새로 생성된 파일

#### `lib/msal.ts`
MSAL 싱글톤 인스턴스 관리.  
`getMsal()` — 최초 1회만 `PublicClientApplication` 생성 + `initialize()`.  
현재 `redirectUri`: `${window.location.origin}/auth/callback`

```ts
import { PublicClientApplication } from '@azure/msal-browser'
// @azure/msal-browser@5.17.0

export async function getMsal(): Promise<PublicClientApplication>
export const MAIL_SCOPES = ['https://graph.microsoft.com/Mail.Send']
```

#### `lib/graphMail.ts`
Graph API 이메일 전송 로직.
- `sendGraphMail(payload)` — silent 토큰 시도 → 실패 시 popup 로그인 → `POST /me/sendMail`
- `clearMsalInteractionState()` — sessionStorage에서 MSAL 잠금 키 강제 제거 (팝업 강제 종료 후 복구용)
- `msalLogout()` — 팝업으로 로그아웃

#### `app/auth/callback/page.tsx`
MSAL OAuth 리다이렉트 전용 페이지 (팝업 콜백 처리용).  
"Authenticating…" 문자만 표시하고 MSAL이 토큰을 처리 후 팝업을 자동 닫음.

```tsx
getMsal().then(msal => msal.handleRedirectPromise()).catch(() => {})
```

### 4. 수정된 파일

#### `app/components/ConditionalLayout.tsx`
`/auth/` 경로는 Supabase 인증 체크 없이 통과하도록 수정.  
(팝업 창에서 전체 앱 레이아웃 로드되는 것 방지)
```ts
const isLogin = pathname === '/login' || pathname.startsWith('/auth/')
```

#### `app/providers.tsx`
초기에는 여기서 `getMsal()` 초기화 시도 → 현재는 `/auth/callback` 페이지에서 처리하므로 불필요하지만 잔존.

#### `app/hr/[company]/page.tsx`
- `mailto:` → `sendGraphMail()` 으로 전송 방식 교체
- Microsoft 계정 연결 상태 표시 UI 추가
- `interaction_in_progress` 오류 시 초기화 버튼 표시

---

## 커밋 히스토리

| 커밋 | 내용 |
|------|------|
| `e780c5a` | Add Microsoft Graph API email sending (초기 구현) |
| `e7d6660` | Handle MSAL popup cancelled state gracefully (팝업 강제 종료 복구) |
| `e3bf1f7` | Init MSAL on every page load to handle popup OAuth callback (providers.tsx에 init 추가) |
| `a761cab` | Fix MSAL popup: use dedicated /auth/callback redirect page (전용 콜백 페이지 생성) |
| `d21aa49` | Call handleRedirectPromise in auth callback page (명시적 콜백 처리 추가) |

---

## Azure Redirect URI 설정 현황

Azure Portal → Entra ID → App registrations → afs-admin → Authentication → SPA

| URI | 상태 |
|-----|------|
| `https://hr.afstransco.com/` (trailing slash) | 삭제 권장 (구버전, 불일치 원인) |
| `https://hr.afstransco.com/auth/callback` | **추가 필요** (현재 코드 기준) |
| `http://localhost:3000/auth/callback` | **추가 권장** (로컬 개발용) |

> ⚠️ Azure에 redirect URI를 아직 `/auth/callback`으로 변경하지 않았다면  
> 반드시 추가해야 팝업 인증이 작동함.

---

## 현재 남은 문제 (미해결)

### 팝업 자동 닫힘 미확인
**현상**: `handleRedirectPromise()` 호출을 추가했으나, 팝업이 자동으로 닫히는지 미확인.  
마지막 테스트(스크린샷)에서 "Authenticating…" 페이지까지는 정상 로드됨.  
`handleRedirectPromise()` 추가 후 추가 테스트 결과 미확인 상태.

**예상 원인 후보**:
1. MSAL v5 (`@azure/msal-browser@5.17.0`)에서 `handleRedirectPromise()`가 여전히 팝업 창을 닫지 않는 경우
2. Azure에 `/auth/callback` redirect URI가 미등록된 경우 (코드와 Azure 불일치)

**다음 시도 방안**:
- `handleRedirectPromise()`가 팝업을 닫지 않을 경우, 수동으로 `window.close()` 호출 고려:
  ```tsx
  getMsal()
    .then(msal => msal.handleRedirectPromise())
    .then(result => { if (result) window.close() })
    .catch(() => {})
  ```
- MSAL v5 → v3 (`@azure/msal-browser@3.x`) 다운그레이드 고려 (v5는 API 변경 많음)
- 팝업 대신 **redirect flow** 방식으로 전환 (팝업 없이 페이지 전환 후 복귀)

---

## 전체 흐름 (설계 기준)

```
[사용자] Send Email 클릭
    ↓
sendGraphMail() 호출
    ↓
acquireTokenSilent() — 캐시된 토큰 시도
    ↓ (캐시 없음 / 만료)
acquireTokenPopup() — 팝업 열기
    ↓
Microsoft 로그인 페이지 (login.microsoftonline.com)
    ↓ (인증 완료)
팝업 → hr.afstransco.com/auth/callback?code=... 리다이렉트
    ↓
handleRedirectPromise() 실행 → 토큰 처리 → 팝업 자동 닫힘  ← 이 부분 미확인
    ↓ (팝업 닫힘)
acquireTokenPopup() 토큰 반환
    ↓
POST https://graph.microsoft.com/v1.0/me/sendMail
    ↓
이메일 발송 완료
```

---

## 참고

- `mailto:` 방식의 한계: From 지정 불가, Outlook 앱 필요, CC/BCC 인코딩 이슈
- Graph API 비용: Microsoft 365 라이선스에 포함, API 호출 자체는 무료
- 발신인 계정: `admin@afstransco.com` / `yungyeong.j@afstransco.com` (둘 다 Microsoft 365 계정이어야 함)
- 로그인한 계정으로만 발송 가능 — 다른 계정 명의 발송 불가 (Send As 권한 별도 설정 필요)
