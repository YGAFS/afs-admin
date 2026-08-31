# Microsoft Graph API 이메일 전송 — 최종 완성 기록

> 작성일: 2026-07-10

---

## 요약

HR 앱의 이메일 리포트 기능을 `mailto:` 방식에서 **Microsoft Graph API 직접 발송**으로 전환 완료.
발신인 지정, HTML 서명 자동 첨부, 실제 발송(Sent Items 기록)이 가능해졌다.

---

## 최종 동작 흐름

```
[사용자] Send Email 클릭
    ↓
acquireTokenSilent() — 캐시된 토큰 시도
    ↓ (캐시 없음)
clearMsalInteractionState() — 구 MSAL 잠금 제거
msal_pending_mail → sessionStorage 저장
acquireTokenRedirect() — 현재 탭이 Microsoft 로그인으로 이동
    ↓ (SSO 또는 로그인 완료)
/auth/callback 페이지 로드
getMsal() → initialize() → urlHash를 sessionStorage에 저장
router.replace(msal_return_url) — HR 페이지로 복귀
    ↓
sendPendingMailAfterRedirect() 실행
handleRedirectPromise() — urlHash 처리 → 토큰 획득
POST https://graph.microsoft.com/v1.0/me/sendMail (HTML + 서명)
    ↓
이메일 발송 완료 ✓
```

---

## 핵심 디버깅 발견 사항

| 문제 | 원인 | 해결 |
|------|------|------|
| 팝업 `timed_out` | MSAL v5에서 popup → postMessage 전달 실패 | redirect flow로 전환 |
| `interaction_in_progress` | 이전 redirect 시도의 MSAL 잠금이 sessionStorage 잔존 | `clearMsalInteractionState()` 호출 후 redirect |
| `인증 후 계정을 찾을 수 없습니다` | callback 페이지의 `handleRedirectPromise()`가 urlHash를 처리 못 함 | **HR 페이지에서 직접 `handleRedirectPromise()` 호출** |
| MSAL v5 핵심 동작 | `initialize()`가 urlHash를 sessionStorage에 저장만 하고 소비 안 함 | `sendPendingMailAfterRedirect()`에서 명시적으로 처리 |

---

## 변경된 파일

### `lib/msal.ts`
- `PublicClientApplication` 싱글톤 + `initialize()` 래퍼
- `redirectUri`: `${window.location.origin}/auth/callback`
- `cacheLocation`: `sessionStorage`

### `lib/graphMail.ts`
- `sendGraphMail()`: silent 시도 → 실패 시 `clearMsalInteractionState()` + `acquireTokenRedirect()`
- `sendPendingMailAfterRedirect()`: HR 페이지 마운트 시 호출, `handleRedirectPromise()`로 urlHash 처리 후 발송
- `clearMsalInteractionState()`: `msal.*interaction.status`, `msal.*request.params` 키 제거
- `_postMail()`: **HTML 형식** 발송, `SIGNATURE_HTML` 상수 자동 첨부

### `app/auth/callback/page.tsx`
- MSAL redirect callback 전용 페이지
- `getMsal()` → `initialize()`(urlHash sessionStorage 저장) → `msal_return_url`로 복귀
- `handleRedirectPromise()`는 HR 페이지에서 처리하므로 여기선 navigation만 담당

### `app/hr/[company]/page.tsx`
- 마운트 시 `sendPendingMailAfterRedirect()` 호출
- 성공 시 모달 열림 + `msalUser` 업데이트
- 이메일 본문에서 발신인 이름 서명 제거 (HTML 서명으로 대체)

### `app/components/ConditionalLayout.tsx`
- `/auth/` 경로는 Supabase 인증 체크 없이 통과

---

## 이메일 서명 (HTML)

`lib/graphMail.ts`의 `SIGNATURE_HTML` 상수에 하드코딩됨:

```
Best regards,

Yun Gyeong Jang
Office Administrator

Email: yungyeong.j@afstransco.com
Mobile: (604) 780-9448
Office: (604) 674-4930
Address: 103 - 15030 54A Ave, Surrey, BC, V3S 5X7

Communication you can trust | Competitive rates | Service you can rely on
See us online at www.afstransco.com
```

- Outlook에서 직접 보내는 메일 → 기존 Outlook 서명 사용
- HR 앱에서 보내는 메일 → 코드의 HTML 서명 사용
- 로고 이미지 필요 시: 공개 URL을 `<img src="...">` 한 줄로 추가 가능

---

## Azure 앱 등록 현황

- **앱 이름**: AFS HR Admin Supported account
- **Client ID**: `afff5bcc-129e-4268-94c3-50fcadc8d61e`
- **Tenant ID**: `7bb58611-6b4d-46c8-be68-37a94daa91b9`
- **플랫폼**: Single-page application (PKCE)
- **API 권한**: `Microsoft Graph > Mail.Send` (Delegated)

**등록된 Redirect URIs:**
- `https://hr.afstransco.com/auth/callback` ✓
- `http://localhost:3000/auth/callback` ✓
- `http://localhost:3000` ✓
- `https://hr.afstransco.com` ✓

---

## 환경 변수

`.env.local` 및 Vercel Production:
```
NEXT_PUBLIC_AZURE_CLIENT_ID=afff5bcc-129e-4268-94c3-50fcadc8d61e
NEXT_PUBLIC_AZURE_TENANT_ID=7bb58611-6b4d-46c8-be68-37a94daa91b9
```

---

## 이메일 본문 형식

```
Hi [수신자 이름],

The following employee is scheduled to be on leave on Jun 9 (Mon).

  • Employee Name - Paid Leave
  • Employee Name - Sick Leave (AM Half)

Please update your records accordingly.

Thank you.

[HTML 서명 자동 첨부]
```

- W (WFH), B (Holiday), O (Overtime) → 이메일 제외
- L / S / T 계열만 포함

---

## sessionStorage 키 목록 (MSAL 관련)

| 키 | 역할 |
|----|------|
| `msal_pending_mail` | 발송 대기 중인 이메일 payload (JSON) |
| `msal_return_url` | 인증 후 복귀할 HR 페이지 경로 |
| `msal_ready_token` | callback 페이지에서 획득한 access token (사용 후 즉시 삭제) |
| `msal.{clientId}.urlHash` | MSAL이 저장한 auth response (HR 페이지에서 처리) |
| `msal.{clientId}.interaction.status` | MSAL redirect 진행 중 잠금 |
| `msal.{clientId}.request.params` | PKCE 코드 검증기 등 요청 파라미터 |
