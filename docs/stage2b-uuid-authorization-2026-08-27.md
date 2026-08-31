# Stage 2B UUID Authorization 작업 기록

- 기록일: 2026-08-27
- 범위: Root AFS Admin, Warehousing, Utility, Vercel Production, Production Supabase
- 목적: email 기반 authorization에서 `auth.users.id` UUID 기반 authorization으로 단계적 전환
- 현재 freeze: `AUTHZ_PERMISSION_MUTATION_FREEZE=false`
- 원칙: 기존 legacy 데이터 보존, 테스트 mutation 즉시 원복, 추가 schema/RLS/grant 변경 금지

## 1. Stage 2B 최종 authorization 모델

- Identity: `auth.users.id`
- Profile: `user_profiles`
- Global admin: `user_global_roles`
- Company admin: `user_company_roles`
- Employee identity: `employee_user_links`
- Root section access: `user_section_access`
- Warehousing app role: `app_user_roles`
- Utility role: 기존 `utility_user_roles` 유지
- Employee linking: 승인된 assignment가 없어 자동 생성하지 않음
- Company roles: 현재 0 rows
- Root `super_admin`: 모든 Root section을 bypass하여 접근
- `user_profiles.status != 'active'`: authorization deny

## 2. 기존 구조와 Stage 2A

기존 Root/Warehousing 권한은 email 기반 `user_access`, `app_access`, `ADMIN_EMAILS`를 사용했다.

Stage 2A에서 다음을 완료했다.

- Root/Warehousing 권한 mutation을 protected server API + service-role 경로로 전환
- 일반 authenticated 사용자의 legacy role 직접 mutation 차단
- Utility `utility_user_roles` privilege escalation 원인 조사
- Utility 기존 `roles_all`, `roles_select` 정책 제거
- Utility anon/PUBLIC 접근 제거
- Utility authenticated direct INSERT/UPDATE/DELETE 차단
- Utility authenticated self-only SELECT 적용
- Utility admin mutation은 protected server API + 기존 `ADMIN_EMAILS` 검증 사용
- Utility business data table RLS는 별도 audit 대상으로 유지

## 3. Utility Stage 2A 잔여 패치

Production baseline에서 `utility_user_roles`는 다음 direct ACL을 보유했다.

- `postgres`: 기존 권한 유지
- `PUBLIC`: explicit privilege 없음
- `anon`: DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- `authenticated`: DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- `service_role`: 기존 권한 유지

적용 결과:

- `roles_all`, `roles_select` 제거
- `anon`: table privilege 없음
- `authenticated`: SELECT만 유지
- `authenticated`: self-only SELECT (`user_id = auth.uid()`)
- `service_role`: 기존 권한 유지
- Utility 기존 admin row 1개 유지

## 4. Stage 2B schema-only migration

Production에서 다음 6개 테이블을 생성하고 검증했다.

- `user_profiles`
- `user_global_roles`
- `user_company_roles`
- `employee_user_links`
- `user_section_access`
- `app_user_roles`

생성 직후 상태:

- 6개 테이블 모두 존재
- RLS enabled
- 신규 authorization table row count 모두 0
- PUBLIC privilege 없음
- anon privilege 없음
- authenticated는 SELECT만 허용
- authenticated INSERT/UPDATE/DELETE 차단
- service_role CRUD 허용
- self-only SELECT policy 6개 존재
- `replace_user_section_access(uuid,text[])` 존재
- 해당 함수 PUBLIC/anon/authenticated EXECUTE 없음
- service_role EXECUTE 허용

Schema-only 단계에서는 profile/backfill, `authz_migrated_at`, legacy table 변경을 실행하지 않았다.

## 5. Freeze 및 UUID-aware code 배포

Root와 Warehousing는 별도 Vercel Production project로 처리했다.

### Freeze

두 프로젝트 Production에 다음을 설정했다.

```text
AUTHZ_PERMISSION_MUTATION_FREEZE=true
```

### UUID-aware code

다음 순서로 배포했다.

1. schema-only migration
2. Root/Warehousing freeze=true
3. UUID-aware code redeploy
4. legacy fallback smoke test
5. cutover

Pre-cutover에서 신규 UUID table이 모두 empty인 상태로 legacy fallback이 정상 동작했다.

## 6. Cutover 및 backfill

`stage2b_cutover.sql`을 Production에서 실행했다.

Transaction 내부에서 다음을 assert했다.

- 신규 UUID authorization table 6개 empty
- `user_access` baseline 3 rows
- `app_access` baseline 1 row
- `utility_user_roles` admin row 정확히 일치
- auth.users 4개 UUID/email mapping 정확히 일치

Backfill 결과:

| 사용자 | UUID | Root sections | Warehousing | Global role |
|---|---|---|---|---|
| admin@afstransco.com | `c29b67d9-3841-41ce-8c40-fb9f7f18bf17` | 6개 전체 | admin | super_admin |
| accounting@afstransco.com | `02c91b44-2d40-4d97-9b6c-2bea88a9ab72` | utilities | 없음 | 없음 |
| cris.b@afstransco.com | `917c90a3-6a6b-4d34-9354-5b7df15f59c9` | hr, utilities, licenses, assets, supplies | 없음 | 없음 |
| yungyeong.j@afstransco.com | `766bd724-c766-4257-8312-e48623a535f3` | utilities | 없음 | 없음 |

최종 backfill count:

- `user_profiles`: 4
- `user_global_roles`: 1
- `user_company_roles`: 0
- `employee_user_links`: 0
- `user_section_access`: 13
- `app_user_roles`: 1
- `utility_user_roles`: 기존 admin row 1개 유지

모든 profile은 `status = 'active'`이며 `authz_migrated_at IS NOT NULL`이다.

## 7. UUID read-path 및 Admin UI robustness

Cutover 직후 Root/Warehousing Admin user list가 일시적으로 `Loading users...`에 고정되는 현상이 관찰됐다.

원인은 `load()` 내부 예외 발생 시 `setLoading(false)`가 보장되지 않는 client robustness 문제로 판단했다.

다음 파일에 최소 patch를 적용했다.

- `app/admin/page.tsx`
- `warehousing/app/admin/page.tsx`

적용 내용:

- 전체 load flow를 `try/catch/finally`로 감쌈
- `finally`에서 항상 `setLoading(false)`
- session/token 없음 처리
- HTTP status 검사
- non-JSON 응답 처리
- `{ users: [...] }` wrapper 및 배열 검증
- `user_id`, `email` 필수값 검증
- malformed row 시 error UI 표시
- 기존 UUID/legacy mapping semantics 유지

Production 재배포 후 다음을 확인했다.

- Root Admin user list: 정상
- Warehousing Admin user list: 정상
- 강제 reload 3회: 무한 Loading 재현 없음
- Root/Warehousing `/api/admin/users`: HTTP 200
- Browser console runtime error 없음
- PATCH/DELETE freeze 상태에서 HTTP 503 확인

## 8. Cutover 후 mutation verification

최종 mutation verification을 위해 두 Production project의 freeze를 해제했다.

```text
AUTHZ_PERMISSION_MUTATION_FREEZE=false
```

두 프로젝트 모두 Production redeploy READY를 확인했다.

### 확인된 내용

- Root UUID PATCH: HTTP 200
- `accounting` sections를 `utilities + assets`로 변경 후 즉시 `utilities`로 복원
- Root refresh 후 `utilities` 상태 유지
- Warehousing UUID PATCH endpoint: HTTP 200
- 최종 Warehousing role: `admin`
- Root/Warehousing Admin GET: HTTP 200
- 최종 `accounting` UUID sections: `utilities`
- 최종 Warehousing UUID role: `warehousing/admin`
- legacy `user_access`: 3 rows
- legacy `app_access`: 1 row
- Utility role row: 기존 row 유지

### 미검증 항목

DELETE API의 최종 동작은 검증하지 못했다.

- Root UUID DELETE HTTP 200
- Warehousing UUID DELETE HTTP 200
- DELETE 후 default deny
- DELETE 후 UUID role/section 즉시 복원

Admin UI는 DELETE API를 직접 호출하지 않았고, 현재 안전하게 인증 session token을 전달하는 별도 테스트 경로가 없어 직접 API 호출 workaround나 DB 직접 mutation을 사용하지 않았다.

따라서 현재 상태는 다음과 같이 기록한다.

> Stage 2B UUID authorization migration completed successfully. UUID read and PATCH persistence paths were verified in Production and restored to baseline. DELETE paths remain unverified because no safe UI/session test path was available; no workaround or direct DB mutation was used.

## 9. 현재 Production 상태

- Stage 2B schema 및 cutover 완료
- UUID read path 정상
- Root/Warehousing PATCH persistence 정상
- 최종 권한 상태 baseline으로 복원
- `user_access`, `app_access`, `utility_user_roles` legacy 데이터 보존
- `AUTHZ_PERMISSION_MUTATION_FREEZE=false`
- DB rollback 실행하지 않음
- 추가 migration 실행하지 않음
- 추가 RLS/grant 변경 없음

## 10. 다음 단계 및 범위 제외

이번 Stage 2B 기록에는 다음을 포함하지 않는다.

- DELETE path 추가 검증
- Stage 2C HR company/employee row-level isolation
- Stage 2D Purchase/Storage authorization
- Utility business-data RLS
- Employee와 auth user의 실제 link assignment
- legacy email authorization 완전 제거

DELETE 검증을 진행하려면 먼저 안전한 authenticated API test harness 또는 명시적인 테스트 session 경로를 준비해야 한다.
