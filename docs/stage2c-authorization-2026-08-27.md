# Stage 2C Authorization 작업 기록

- 기록일: 2026-08-27
- 범위: HR company authorization, protected HR API, Employee Directory API, Production Supabase RLS
- 선행 기록: `docs/stage2b-uuid-authorization-2026-08-27.md`
- Production: `https://hr.afstransco.com`
- Supabase project: `afs-admin` / `main Production`

## 1. Stage 2C 목표

- employee는 본인 HR 데이터만 조회
- `hr_admin` / `company_admin`은 명시적으로 배정된 회사만 관리
- `super_admin`은 전체 회사 접근
- Employee Portal v1은 read-only protected API 사용
- 첫 기능 범위: PTO policy 및 본인 vacation/sick usage/balance

## 2. Cris company assignment

`cris.b@afstransco.com`은 global admin 또는 `super_admin`으로 승격하지 않았다.

| user | UUID | company | role |
|---|---|---|---|
| cris.b@afstransco.com | `917c90a3-6a6b-4d34-9354-5b7df15f59c9` | AFS | `hr_admin` |
| cris.b@afstransco.com | `917c90a3-6a6b-4d34-9354-5b7df15f59c9` | TNT | `hr_admin` |
| cris.b@afstransco.com | `917c90a3-6a6b-4d34-9354-5b7df15f59c9` | ZFS | `hr_admin` |

기존 Root section access는 유지했다.

- 허용: `hr`, `utilities`, `licenses`, `assets`, `supplies`
- 미허용: `admin`
- `super_admin`: 없음

## 3. Stage 2C-A protected application

다음 공통 server authorization을 구현했다.

- Bearer token/session authentication
- `auth.users.id` resolve
- `user_profiles.status = 'active'` 필수
- `super_admin` global bypass
- 그 외 명시적 `user_company_roles` 필요
- employee 대상 요청은 서버에서 `employees.company_id` resolve
- client-supplied company scope는 authorization assertion으로 사용하지 않음
- authorization query error는 deny
- service-role DB access는 authorization 성공 후에만 사용

구현 파일:

- `lib/server/hrAuthorization.ts`
- `lib/hrApi.ts`
- `app/api/hr/[...path]/route.ts`

보호 대상:

- `employees`
- `leave_entries`
- `attendance_notes`
- `attendance_flags`

UI direct Supabase CRUD를 protected API 호출로 전환했다.

- `app/hr/[company]/page.tsx`
- `app/hr/components/AttendanceGrid.tsx`
- `app/hr/components/EmployeeSearch.tsx`
- `app/hr/components/HrSummaryCards.tsx`

회사 route는 canonical company code/UUID를 사용하며 fuzzy `ilike` resolution은 제거했다.

## 4. Stage 2C-B employee directory API

Assets/Licenses는 HR role 없이도 별도 Root section 권한으로 employee 이름을 resolve해야 하므로 최소 directory API를 추가했다.

구현 파일:

- `lib/server/employeeDirectoryAuthorization.ts`
- `app/api/employee-directory/route.ts`
- `app/assets/page.tsx`
- `app/licenses/page.tsx`

정책:

- active profile 필수
- `super_admin` bypass
- 또는 해당 Root section(`assets` / `licenses`) 명시 권한 필요
- service-role access는 authorization 성공 후에만 수행
- 반환 fields는 `id`, `name`만 포함
- PTO, attendance 등 HR-sensitive field는 반환하지 않음

## 5. Production deployment

Stage 2C-B application 변경을 Vercel Production에 배포했다.

- Deployment: `dpl_5HrG9WNmmeQA34pnFdubxULnA9Cd`
- URL: `https://afs-admin-2x9emcnz0-afs-admin-s-projects.vercel.app`
- Alias: `https://hr.afstransco.com`
- Vercel build: PASS
- TypeScript check: PASS
- Next.js routes에 `/api/employee-directory` 및 protected HR API 포함 확인

## 6. Pre-RLS application verification

| 항목 | 결과 |
|---|---|
| Cris AFS HR | PASS |
| Cris TNT HR | PASS |
| Cris ZFS HR | PASS |
| Cris Assets | PASS |
| Cris Licenses | PASS |
| Assets employee names | PASS |
| Licenses employee names | PASS |
| `/api/hr/employees` | HTTP 200 |
| `/api/hr/summary` | HTTP 200 |
| `/api/hr/attendance` | HTTP 200 |
| browser direct target-table references | 0 |

남은 `employees`, `leave_entries`, `attendance_notes`, `attendance_flags` 참조는 server/API service-role 코드뿐이다.

## 7. Stage 2C-B RLS migration

준비 및 실행 파일:

- `supabase/stage2c_b_hr_rls.sql`
- `supabase/stage2c_b_hr_rls_rollback.sql`

Migration 실행 전 검토 항목:

- transaction-wrapped
- current RLS/policy/grant baseline fail-fast assertions
- helper functions `SECURITY DEFINER`
- `SET search_path = ''`
- schema-qualified table references
- inactive profile deny
- `super_admin` bypass
- explicit company HR role scope
- linked employee self SELECT
- employee direct writes deny
- `allow_all_attendance_notes` 명시적 제거
- authenticated direct table privileges revoke
- service-role CRUD retained
- rollback precondition/postcondition assertions
- helper가 target HR table을 다시 조회하지 않아 recursive RLS dependency 없음

### Migration 실행 결과

2026-08-27 Production Supabase SQL Editor에서 migration을 실행했다.

- assertion failure: 없음
- 결과: `Success. No rows returned`
- transaction rollback: 없음
- migration commit: 성공
- companies table/policy/grant: 변경하지 않음

### Migration 직후 catalog 결과

| table | rls_enabled | rls_forced |
|---|---:|---:|
| employees | true | false |
| leave_entries | true | false |
| attendance_notes | true | false |
| attendance_flags | true | false |

각 table에 Stage 2C-B scoped policy 4개가 존재한다.

- SELECT
- INSERT
- UPDATE
- DELETE

`attendance_notes`에는 legacy `allow_all_attendance_notes`가 더 이상 존재하지 않는다.

Effective table privileges:

- `anon`: SELECT/INSERT/UPDATE/DELETE 모두 false
- `authenticated`: SELECT/INSERT/UPDATE/DELETE 모두 false
- `service_role`: SELECT/INSERT/UPDATE/DELETE 모두 true

## 8. Post-RLS Cris smoke test

### Read access

| 항목 | 결과 |
|---|---|
| AFS HR page | PASS |
| TNT HR page | PASS |
| ZFS HR page | PASS |
| employee list/search | PASS |
| Attendance Grid | PASS |
| HR Summary | PASS |
| leave data display | PASS |
| attendance note display | PASS |
| attendance flag display | PASS |
| Assets | PASS |
| Licenses | PASS |
| employee name resolution | PASS |

Production logs에서 protected HR API가 HTTP 200으로 응답했다.

### Mutation and restore

안전한 기존 employee와 비어 있는 날짜를 사용했다.

| 테스트 | 결과 |
|---|---|
| leave create → persistence → delete → refresh | PASS |
| attendance note create → confirm → delete → refresh | PASS |
| attendance flag create → confirm → delete → refresh | PASS |
| test marker/data final removal | PASS |

테스트 후 leave, note, flag marker는 refresh 후 모두 사라졌으며 baseline으로 복구되었다.

## 9. Authorization regression

### Cris

- `/admin` 접근: `/hr`로 redirect, PASS
- `/api/admin/users`: HTTP 403, PASS
- language patch toggle: 비노출, PASS

### Admin / super_admin

Admin 계정은 기존 smoke test에서 AFS/TNT/ZFS HR, user management, language patch toggle을 정상 확인했다. Stage 2C-B migration은 admin authorization table을 변경하지 않았고, post-migration protected HR API log도 HTTP 200으로 확인했다.

## 10. Direct Supabase bypass 결과

Catalog에서 일반 `anon` 및 `authenticated` role의 네 HR table 직접 권한이 모두 제거된 것을 확인했다.

- employees direct CRUD: privilege denied
- leave_entries direct CRUD: privilege denied
- attendance_notes direct CRUD: privilege denied
- attendance_flags direct CRUD: privilege denied

별도 JWT를 추출하지 않고 browser에서 raw authenticated REST request를 생성하는 방식은 수행하지 않았다. 인증 token/storage를 읽지 않고도 확인 가능한 catalog privilege와 RLS policy 결과로 direct bypass 차단 상태를 검증했다.

## 11. 최종 Production 상태

- Stage 2C-A protected HR API: 배포 및 smoke test 완료
- Stage 2C-B HR RLS: Production 적용 완료
- authenticated direct HR table SELECT/CRUD: 차단
- service-role protected API access: 유지
- Cris AFS/TNT/ZFS HR company role: 유지
- Cris `super_admin`: 없음
- Cris `admin` Root section: 없음
- 테스트 데이터: baseline 복구
- `companies` mutation/RLS/grant: 이번 migration에서 변경하지 않음

## 12. 별도 후속 작업

- `companies` table의 broader anon/authenticated CRUD privilege cleanup
- Employee Portal v1 protected read-only API 구현
- `employee_user_links` 실제 assignment 및 self-access 검증
- PTO policy schema/API/UI 구현
- authenticated direct REST deny에 대한 별도 non-secret test harness
