# AFS 보안 감사 및 Stage 1/2A 운영 기록

- 기록일: 2026-08-26
- 범위: Root AFS Admin, Warehousing, Vercel, Production Supabase
- 원칙: 기존 기능·데이터 보존을 우선하며, 테스트 mutation은 원상복구
- Supabase Stage 2A migration 이후 추가 DB 변경: 없음
- Secret 값: 문서에 기록하지 않음

## 1. Phase 1 감사 요약

Production Supabase SQL Editor에서 다음을 확인했다.

- `employees`, `leave_entries`, `attendance_flags`, `attendance_notes`, `subscriptions`, `subscription_employees`는 초기 상태에서 RLS가 꺼져 있거나 anon 접근이 가능했다.
- `attendance_notes`에는 `public` 대상의 사실상 전체 허용 policy가 있었다.
- `user_access`, `app_access`, `purchase_requests`에는 authenticated 대상의 `USING (true)` / `WITH CHECK (true)` 정책이 있었다.
- `user_access`와 `app_access`에는 authenticated 전체 CRUD 권한이 있었다.
- service role은 필요한 CRUD 권한을 보유하고 있었다.
- 함수 `next_purchase_request_number`, `set_updated_at`은 SECURITY DEFINER가 아니었다.

## 2. Stage 1 Emergency Patch

목표는 기존 authenticated 관리자 기능을 유지하면서 unauthenticated/anon 접근만 우선 차단하는 것이었다.

다음 테이블에서 anon 및 PUBLIC 접근을 제거했다.

- `employees`
- `leave_entries`
- `attendance_flags`
- `attendance_notes`
- `subscriptions`
- `subscription_employees`

검증 결과:

- anon SELECT/INSERT/UPDATE/DELETE: 모두 `false`
- authenticated 기존 관리자 CRUD: 유지
- 실제 익명 REST 요청: HTTP 401과 Supabase `42501 permission denied` 확인
- 관리자 UI smoke test: 직원 조회·수정, PTO, attendance note/flag, subscription 기능 정상

RLS는 이 단계에서 활성화하지 않아 기존 관리자 UI 중단을 피했다.

## 3. Stage 2A 코드 변경

목표는 일반 authenticated 사용자가 권한 관리 테이블을 직접 변경하지 못하게 하고, 관리자 작업을 보호된 server-side API로 전환하는 것이었다.

### 변경된 주요 파일

- `app/admin/page.tsx`: `user_access` direct SELECT/UPSERT 제거, `/api/admin/users` 호출로 전환
- `app/api/admin/users/route.ts`: 관리자 인증, 독립 service-role client, `user_access` GET/PATCH 제공
- `warehousing/app/admin/page.tsx`: `app_access` direct SELECT/UPSERT/DELETE 제거, API 호출로 전환
- `warehousing/app/api/admin/users/route.ts`: 관리자 인증, 독립 service-role client, `app_access` GET/PATCH/DELETE 제공
- `next.config.ts`: Root build에서 `tsconfig.build.json` 사용
- `tsconfig.build.json`: Root source만 type-check하고 `warehousing` 제외

HR DELETE handler는 실제 UI/workflow 사용처가 없어 제거했으며, Warehousing DELETE는 `No Access` workflow 때문에 유지했다.

service-role key는 server API route에서만 참조하며 client component나 client bundle에서 참조하지 않는다.

## 4. Build 및 배포

### Root AFS Admin

- Root Production build: PASS
- 배포 alias: `https://hr.afstransco.com`
- Production deployment: `afs-admin-c6fw0un83-afs-admin-s-projects.vercel.app`

### Warehousing

- Warehousing Production build: PASS
- 배포 alias: `https://afs-admin-rovv.vercel.app`
- Production deployment: `afs-admin-rovv-gdu5ly7ur-afs-admin-s-projects.vercel.app`

Vercel 환경변수 확인:

- Root와 Warehousing 모두 `SUPABASE_SERVICE_ROLE_KEY`가 Secret으로 설정됨
- `NEXT_PUBLIC_` prefix로 service-role key를 노출하지 않음
- Preview 설정은 유지됨

## 5. Stage 2A Supabase migration

### Migration 전 상태

- `user_access`, `app_access` 모두 RLS enabled, forced false
- 기존 policy: `user_access_all`, `user_access_select`, `app_access_all`, `app_access_select`
- 기존 policy는 authenticated 대상의 전체 row를 허용
- anon/authenticated/service_role에 table privilege가 존재

### 적용한 목표 상태

- 기존 전체 허용 policy 제거
- `user_access_self_select`, `app_access_self_select`만 생성
- self-only 조건:

```sql
lower(btrim(email)) = lower(btrim(auth.jwt() ->> 'email'))
```

- anon 및 PUBLIC table privilege 제거
- authenticated INSERT/UPDATE/DELETE 제거, SELECT 유지
- service_role CRUD 유지
- 데이터 삭제·schema 변경·column 변경 없음

### Migration 후 검증

- self-only SELECT policy만 존재: PASS
- anon SELECT/INSERT/UPDATE/DELETE: 모두 `false`
- authenticated SELECT: `true`
- authenticated INSERT/UPDATE/DELETE: 모두 `false`
- service_role CRUD: 모두 `true`

## 6. Production smoke test

### HR

- Admin 페이지 접근: PASS
- `/api/admin/users` GET: PASS
- `user_access` 관리자 PATCH: PASS
- 테스트 계정 권한 원복 및 새로고침 확인: PASS
- HR, attendance, subscription 및 주요 기존 화면: PASS

### Warehousing

초기에는 구버전 Production deployment가 direct Supabase mutation을 사용해 migration 후 `POST /rest/v1/app_access`가 HTTP 403 및 Supabase `42501`로 차단됐다.

Stage 2A Warehousing Production 재배포 후:

- Admin 페이지 접근: PASS
- `app_access` 목록 조회: PASS
- role PATCH: PASS, `/api/admin/users` HTTP 200
- PATCH 후 새로고침 재조회로 persistence 확인: PASS
- 직접 `/rest/v1/app_access` mutation 미발생: PASS
- `No Access` 전환 시 `/api/admin/users` DELETE HTTP 200: PASS
- DELETE 후 새로고침 및 원복 상태 확인: PASS
- Vercel Runtime Log에서 GET/PATCH/DELETE serverless route 실행 확인: PASS

테스트 계정 `accounting@afstransco.com`의 최종 상태는 HR과 Warehousing 모두 테스트 전 상태로 원복했다.

## 7. 잔여 항목

- Authorization 없음 및 invalid token의 HTTP status는 현재 401 대신 403을 반환한다. 접근 자체는 차단되며 LOW priority 개선사항으로 기록한다.
- 일반 authenticated 계정의 실제 403 테스트는 별도 일반 계정 세션 부재로 INCOMPLETE다.
- `Multiple GoTrueClient instances detected` browser warning이 관찰되었다. 현재 관리자 flow는 정상이나 장기적으로 client singleton 정리가 권장된다.
- self-only policy는 현재 email 기반 임시 방식이다. Employee Portal 도입 전 UUID mapping 및 company isolation을 포함한 후속 설계가 필요하다.

## 8. 다음 단계

- `user_access`/`app_access` role 모델 정교화
- employee/user UUID mapping
- HR company isolation
- Employee Portal용 employees/PTO/attendance/sick leave RLS
- default privileges 및 신규 테이블 migration 규칙

이 문서의 범위를 넘어서는 Production DB 변경은 이 기록 시점에 실행하지 않았다.
