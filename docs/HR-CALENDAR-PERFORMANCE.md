# HR Calendar 성능 개선 작업 기록

최종 업데이트: 2026-09-01

## 목표

HR Calendar의 저장 지연과 최초 Calendar 진입 지연을 실제 timing으로 분리해 확인하고, 보안 semantics와 기존 HR 기능을 유지하면서 최소 범위의 성능 개선을 적용했다.

## 1. 저장 경로 조사 및 개선

초기에는 POST → PATCH → 전체 `load()` 흐름과 약 71초 지연 가능성을 조사했다. 실제 Production timing 확인 결과 71초는 HR 저장 latency가 아니라 Codex 작업 시간이었다.

JWT fast path 적용 후 확인된 Production 기준:

- POST median: 약 132ms
- DELETE median: 약 268ms
- strict authorization fallback: 0회
- HR Admin security behavior: 정상

### 적용된 UX 개선

파일: `app/hr/components/AttendanceGrid.tsx`

- `Saving...` 표시를 요청 시작 즉시 노출하지 않고 300ms 지연
- 300ms 이내 완료되는 요청은 indicator를 표시하지 않음
- 중첩 작업을 고려한 saving operation count 적용
- Vacation/Sick 생성 시 optimistic state 반영
- Vacation/Sick 삭제 시 optimistic state 제거
- API 실패 시 leave state와 통계 rollback
- 성공 시 서버 canonical row로 reconcile
- API 요청 자체와 기존 error handling은 유지

커밋:

- `b76e2c7` — Improve HR calendar save responsiveness

## 2. HR Admin JWT fast path

Employee Portal과 RLS/권한 구조는 변경하지 않고 HR Admin 일반 작업에만 signed claim fast path를 적용했다.

- verified JWT claims 기반 HR Admin 확인
- `hr_role`, `hr_company_ids`, `hr_active` claim 사용
- claim이 유효하지 않으면 strict authorization fallback
- employee/company consistency validation 유지
- 권한 변경·profile 비활성화·company access 변경 등 critical endpoint는 fast path 대상에서 제외
- Production kill switch: `HR_ADMIN_JWT_FAST_PATH_ENABLED`

관련 커밋:

- `35ea1e3` — Add signed JWT fast path for HR admin APIs
- `3211daa` — Add HR admin JWT fast path kill switch
- `1b068a0` — Ensure auth hook schema grant is reproducible

## 3. Calendar 최초 진입 병목 계측

### 패치 전

`/hr/afs` 진입 시:

- Attendance GET 2회 실행
- 첫 요청: 약 772ms
- 두 번째 요청: 약 593ms
- click → Calendar table DOM: 약 3,323ms

원인:

1. `AttendanceGrid`가 `companyCode=AFS`로 최초 Attendance GET 실행
2. 부모 페이지가 `companyCode → companyId` 조회 실행
3. `companyId` state 변경이 `AttendanceGrid` effect dependency를 변경
4. 동일 Attendance GET 재실행

### 적용된 초기 로드 개선

파일: `app/hr/components/AttendanceGrid.tsx`

- 초기 load effect dependency에서 `companyId` 제거
- 이미 안정적으로 제공되는 `companyCode`를 Attendance 조회에 사용
- 회사 lookup은 다른 HR 기능 때문에 유지
- companyId 변경만으로 Attendance 재조회가 발생하지 않도록 변경

추가 계측:

- Attendance API 완료
- data transformation
- AttendanceGrid render 시작
- React commit
- table DOM/paint
- employee row 수와 calendar cell 수

## 4. 최초 Calendar 측정 결과

Production 동일 조건 5회 측정 결과:

| 항목 | Before | After median |
|---|---:|---:|
| Attendance GET count | 2회 | 1회 |
| Attendance GET duration | 772ms + 593ms | 519ms |
| click → Calendar DOM | 3,323ms | 약 729ms |
| API complete → React commit | 미계측 | 13ms |
| React commit → table DOM | 미계측 | 1ms |
| data transformation | 미계측 | 4ms |
| rendered employee rows | - | 14 |
| rendered calendar cells | - | 420 |

초기 load instrumentation 값:

- API 완료: `710, 550, 734, 578, 650ms`
- data transformation: `5, 1, 5, 1, 4ms`
- API → React commit: `18, 14, 13, 8, 12ms`
- React commit → DOM: `3, 1, 1, 1, 1ms`
- load 시작 → table DOM: `732, 565, 747, 587, 663ms`

결론적으로 기존 API 완료 후 약 1.4초로 관찰된 구간은 실제 React 계산 병목이 아니었다. 실제 Calendar data transformation은 수 ms, React commit은 약 13ms, DOM 반영은 약 1ms였다. 핵심 원인은 중복 Attendance GET과 초기 route transition이었다.

## 5. 보안 및 기능 범위

변경하지 않은 항목:

- Supabase RLS
- HR authorization requirements
- JWT signing/verification semantics
- Employee Portal authorization
- Vacation/Sick 계산 semantics
- PTO calculation
- Production data 구조
- backend save API contract

`companyCode` 기반 Attendance 조회는 기존과 동일하게 API authorization 및 company scope 검증을 거친다. `companyId` 변경에 따른 불필요한 재조회만 제거했다.

## 6. 배포 기록

### 저장 UX 배포

- Commit: `b76e2c7`
- Production deployment: `dpl_HaMA3FEkZ7bXezEqfTjTLNPjiPGU`

### Calendar 최초 로드 배포

- Commit: `ae13c49`
- Production deployment: `dpl_5KQL2jaAWWjz3zdBjv5hmDtSJiZs`
- Status: `READY`
- Alias: `https://hr.afstransco.com`

배포 시 로컬에 이미 존재하던 unrelated generated/deployment 파일은 커밋하지 않았다.

## 7. 남아 있는 관찰 및 후보

- `/api/hr/companies?code=AFS` lookup은 다른 페이지 기능 때문에 유지 중이다.
- 브라우저에서 `Multiple GoTrueClient instances detected` 경고가 관찰됐지만, 현재 Calendar latency의 직접 원인으로 확정할 timing 근거는 없다.
- 동일 cell에 여러 작업을 동시에 겹쳐 실행하는 비정상적 사용 패턴은 optimistic snapshot 순서 영향을 받을 수 있으므로 별도 concurrency 테스트 후보로 남겨둔다.
