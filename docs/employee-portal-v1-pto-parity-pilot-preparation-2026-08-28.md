# Employee Portal v1 — PTO parity decision and pilot preparation

검사일: 2026-08-28  
Production 읽기 전용 검사만 수행. Auth user, profile, link, employee row, 권한, RLS, table privilege는 변경하지 않음.

## 1. Exact PTO parity comparison

### Vacation entitlement

| 항목 | EmployeeSearch | AttendanceGrid | HR에 현재 표시되는 값 | 차이가 바뀌는 예 | 변경 시 Production-visible 영향 | 원인 |
|---|---|---|---|---|---|---|
| entitlement | `employees.vacation_allowance`를 annual entitlement로 사용 | 동일 | 직원 상세 패널과 grid 모두 DB allowance | allowance 10이면 둘 다 10 | 로직 변경 시 양쪽에 직접 영향 | 차이 없음 |
| `is_exempt` | true면 vacation card를 `null`로 숨김 | true면 `vacDisplay`가 `null` | 두 화면 모두 vacation balance 미표시 | allowance 10이어도 카드 없음 | 바꾸면 해당 직원의 HR 화면 표시 변경 | 차이 없음 |
| `uses_accrual` | true면 anniversary accrual, false면 allowance - used | true면 anniversary accrual, false면 calendar-year allowance - taken | 직원 상세와 grid 모두 employee flag 분기 | allowance 10, used 2: fixed는 8 | 분기 변경 시 즉시 잔액 변경 | 차이 없음 |

### Accrued vacation and start date

| 항목 | EmployeeSearch | AttendanceGrid | HR에 현재 표시되는 값 | 차이가 바뀌는 예 | 변경 시 Production-visible 영향 | 원인 |
|---|---|---|---|---|---|---|
| anniversary period | `getAllAnnivPeriods(start_date, asOf)`로 전체 기간 생성 | `getAnnivPeriods(start_date, new Date())`로 전체 기간 생성 | 현행 HR balance는 입사 anniversary 기준 | start 2025-10-01, asOf 2026-08-28 → 현재 period 2025-10-01~2026-09-30 | 입사일/period 기준 변경은 양쪽 잔액 변경 | `2ea8d5a`/`64aacb2`의 anniversary carryover 도입 |
| accrued formula | `floor(elapsed ms / 86400000) / 365 × allowance`, 2 decimals | `(asOf - periodStart) / 86400000 / 365 × allowance`, 2 decimals | 상세는 2자리, grid 내부 표시는 1자리 | pilot: 331/365×10 = **9.07** | 수식/rounding 변경 시 표시·잔액 변경 | 같은 daily-basis 변경(`5b2748c`); floor 처리만 명시적으로 다름 |
| as-of date | active: today; terminated: `end_date` | 항상 `new Date()`로 계산 | 상세는 terminated를 end date 기준으로 표시; grid는 현재 시점 기준 | 종료일이 2026-06-30이면 상세는 종료일 기준, grid는 8/28 기준 | 종료자 balance가 달라질 수 있음 | `46255e3`에서 EmployeeSearch의 end-date 처리 도입; grid는 동일 보정이 없음 |
| `start_date` future | period가 없으면 상세 vacation stats 없음 | period가 없으면 accrued=0, carry=0, used=0 | future hire 표시 방식이 다를 수 있음 | start 2026-12-01이면 상세는 `null`, grid stat은 0 | 바꾸면 예정 입사자 HR 표시 변경 | 별도 화면 구현에서 발생한 분기 차이 |

### Vacation used and remaining

| 항목 | EmployeeSearch | AttendanceGrid | HR에 현재 표시되는 값 | 차이가 바뀌는 예 | 변경 시 Production-visible 영향 | 원인 |
|---|---|---|---|---|---|---|
| balance used | anniversary current period에서 `L/L1/L2/L3`를 합산; current as-of 이후 행 제외 | 동일 code를 anniversary current period에 합산; current as-of 이후 행 제외 | 상세 `Used`, grid `periodUsed` 모두 실제 현재 period 사용량 | pilot 현재 period used = **1** (`L` 2026-06-30) | code/date filter 변경 시 balance 변경 | 공통으로 `64aacb2` anniversary logic 사용 |
| calendar summary used | `loadStats`의 year summary는 해당 연도 모든 row를 date prefix로 합산하며 미래 row도 포함 | `yearEntries` 전체 연도 row를 합산하며 미래 row도 포함; accrual balance에는 별도 period filter | EmployeeSearch 월별 summary와 grid year summary에 미래 예약 leave가 포함될 수 있음 | pilot 2026 vacation summary = June 1 + November future 9 = **10**, balance used = **1** | summary 정의 변경 시 HR summary 표시 변경 | summary와 balance가 서로 다른 목적이라 분리 구현됨 |
| remaining | accrual: `max(0, round(accrued + carryIn - periodUsed, 2))`; fixed: allowance - periodUsed | accrual: `max(0, round((accrued+carryIn-periodUsed), 1 display))`; fixed: allowance - calendar-year taken | pilot 상세 = **8.07 days**, grid 표시 = **8.1/9.1** 수준 | 미래 예약 9일을 balance에서 빼면 8.07이 0 미만으로 clamp되는 등 큰 차이 | balance semantics 변경은 Production-visible | 상세와 grid의 presentation precision 차이; underlying accrual result는 현재 pilot에서 동일 |

### Carryover

| 항목 | EmployeeSearch | AttendanceGrid | HR에 현재 표시되는 값 | 차이가 바뀌는 예 | 변경 시 Production-visible 영향 | 원인 |
|---|---|---|---|---|---|---|
| completed period | full allowance; `remaining=max(0, allowance+carryIn-used)` | 동일 | 두 화면 모두 carry-in을 포함한 current balance | prior remaining 7 → carry-in 5 | carryover cap/period 변경은 잔액 변경 | `2ea8d5a` / `64aacb2` |
| cap | `min(5, remaining)`; excess=`max(0, remaining-5)` | `min(5, remaining)`; excess not surfaced in grid stat | 상세는 expired/paid-out 값을 별도 표시; grid는 carry-in만 사용 | prior remaining 7이면 next carry-in 5, excess 2 | cap 변경은 양쪽 잔액 변경; excess display는 상세만 영향 | 상세 history가 추가됐지만 grid return type은 축약형 |
| history horizon | all periods from start date; it fetches all leave rows | only previous-previous, previous, current calendar-year rows are supplied by `/api/hr/attendance` | 장기근속자는 화면별 carry-in이 달라질 수 있음 | 2023 row가 필요한 2026 cascade에서 grid input이 없으면 carry-in/remaining 차이 | fixing grid would alter existing grid-visible results | `/api/hr/attendance` response design, not policy intent |

### `probation_end`

| 항목 | EmployeeSearch | AttendanceGrid | HR에 현재 표시되는 값 | 차이가 바뀌는 예 | 변경 시 Production-visible 영향 | 원인 |
|---|---|---|---|---|---|---|
| PTO accrual use | active calculation starts at anniversary/start date; `probation_end` is not used | `effectiveAccrualStart` considers `probation_end`, but active `calcAnnivVacStat` does not call it | probation is shown as employee detail, not currently applied to these balance results | pilot probation end 2026-01-01: current balance still accrues from 2025-10-01 | applying probation would reduce pilot and other employee balances | legacy helper remained after later anniversary refactor |
| display | shown as probation dates/badge in both HR components | shown as probation dates/badge in grid | admin sees the date/status, not a probation-adjusted PTO balance | no numeric change by itself | changing display only affects UI; applying it affects balance | helper/UI history in git |

### Leave codes and sick allowance

| 항목 | EmployeeSearch | AttendanceGrid | HR에 현재 표시되는 값 | 차이가 바뀌는 예 | 변경 시 Production-visible 영향 | 원인 |
|---|---|---|---|---|---|---|
| `L` | 1 day | 1 day | vacation used 1 | one row → +1 | yes | no difference |
| `L1/L2` | 0.5 day | 0.5 day | vacation used half day | two half-days → 1 | yes | no difference |
| `L3` | 1 day; stored hours ignored for day usage | 1 day; stored hours ignored for day usage | hourly leave contributes one vacation day, display hours are derived as days×8 | `L3, hours=2` → both used 1 day, not 0.25 | changing to hour-derived would alter current HR result | current code explicitly preserves legacy row weighting |
| `S` | 1 day | 1 day | sick used 1 | one row → +1 | yes | no difference |
| `S1/S2` | 0.5 day | 0.5 day | sick used half day | `S2 + S` → 1.5 | yes | no difference |
| `S3` | 1 day; stored hours ignored | 1 day; stored hours ignored | sick used one day | `S3, hours=2` → both used 1 day | hour-derived change alters HR result | same legacy weighting as L3 |
| sick allowance | paid = `min(total sick, 5)`; unpaid = `max(total-5,0)` | year summary counts sick; detailed sick card in EmployeeSearch is the explicit allowance display | allowance **5 days**, remaining `5-paid`, alert when total `>8` | pilot sick rows total **5.0**, paid 5, remaining 0, unpaid 0, alert false | threshold/allowance change immediately alters card | constants are hardcoded in EmployeeSearch; grid has no equivalent sick allowance card |

### Pilot numerical result from current Production rows

The matched employee has start date `2025-10-01`, allowance `10`, accrual enabled, not exempt, and no end date. As of 2026-08-28:

- current anniversary period: 2025-10-01–2026-09-30;
- elapsed days: 331;
- accrued vacation: 9.07;
- current-period vacation used: 1.00 (`L` on 2026-06-30);
- carry-in: 0 (first anniversary period has not closed);
- remaining: 8.07;
- sick used: 5.00 (`S2` + `S1` as half-days and three full `S` rows);
- paid sick allowance: 5.00; sick remaining: 0.00; unpaid sick: 0.00; alert: false;
- future November vacation rows are in calendar-year summaries but are excluded from the current balance because they are after the as-of date.

## 2. Canonical Portal v1 semantics

Canonical choice: **EmployeeSearch’s detailed employee PTO balance behavior**, with its current as-of rules.

Reason:

1. It is the explicit employee-level PTO status surface (`Accrued`, `Carried over`, `Used`, `Remaining`, paid/unpaid sick) that an employee portal is intended to mirror.
2. It reads all leave history needed for the anniversary cascade, whereas the grid API currently supplies only three calendar years.
3. It handles terminated employees by using `end_date` as the effective date.
4. It keeps calendar-year summary usage separate from the actual current-period balance.

This is a Portal v1 read model decision, not permission to refactor Admin. Existing Admin screens remain unchanged. The Portal should reproduce EmployeeSearch’s current balance semantics and return leave history separately. It must retain `L3/S3 = 1 day`, ignore stored hours for PTO-day calculation, use 5-day carryover, 5-day paid sick allowance, and `>8` sick alert. Policy cleanup is deferred.

The decision resolves the previous ambiguity; no further policy decision is required before implementing the endpoint. A later parity test suite should record the known grid divergence rather than silently merge it.

## 3. Pilot Auth verification and mapping

Production read-only verification:

| check | result |
|---|---|
| email `yungyeong.j@afstransco.com` exists | yes |
| Auth UUID | `766bd724-c766-4257-8312-e48623a535f3` |
| UUID matches requested value | yes |
| `user_profiles` | one row, `status = active`, display `Yungyeong J.` |
| global role | none |
| company HR role | none |
| UUID section access | `utilities` only |
| legacy `user_access` | `utilities` only |
| existing link by user | none |
| existing link by candidate employee | none |

The Utilities access is an existing convenience permission. The future portal authorization must not depend on it, on root section access, or on company roles.

### Unambiguous employee row

Exactly one Production `employees` row matched `Yungyeong`:

| field | value |
|---|---|
| `employees.id` | `f92744b5-d28a-476c-b34e-198ced787983` |
| `name` | Yungyeong Jang |
| `company_id` | `ea2925b2-5d7d-4dd2-9086-1a3a51ccbcc5` |
| company code/name | `AFS` / `AFS Trans Co.` |
| `start_date` | 2025-10-01 |
| `end_date` | null |
| `vacation_allowance` | 10 |
| `uses_accrual` | true |
| `is_exempt` | false |
| `probation_start` | 2025-10-01 |
| `probation_end` | 2026-01-01 |
| `employment_type` | office |
| `is_active` | true |

No employee data was changed.

## 4. `employee_user_links` state and constraints

Production reads show zero rows currently. The Stage 2B schema definition is:

- `employee_id uuid primary key references employees(id) on delete cascade`;
- `user_id uuid not null unique references user_profiles(user_id) on delete cascade`;
- `created_at timestamptz not null default now()`.

Therefore the intended schema permits:

- one user → **at most one employee** (`user_id unique`);
- one employee → **at most one user** (`employee_id primary key`).

The repository defines no separate `employee_user_links` index beyond the primary-key index on `employee_id`; the unique constraint on `user_id` also has a unique index in PostgreSQL. A direct `pg-meta` catalog query was unavailable from this environment, so the live constraint assessment is based on the deployed Stage 2B schema source plus the Production table reads. No schema modification is needed.

## 5. Exact pilot assignment SQL — do not execute yet

This is intentionally fail-closed: it inserts nothing if the Auth/profile/employee mapping is not exactly the expected one, and it raises instead of overwriting a conflicting link.

```sql
begin;

do $$
declare
  v_user_id constant uuid := '766bd724-c766-4257-8312-e48623a535f3';
  v_employee_id constant uuid := 'f92744b5-d28a-476c-b34e-198ced787983';
  v_email constant text := 'yungyeong.j@afstransco.com';
  v_existing_employee uuid;
  v_existing_user uuid;
begin
  if not exists (
    select 1 from auth.users
    where id = v_user_id
      and lower(email) = v_email
      and deleted_at is null
  ) then
    raise exception 'Expected Auth user/email mapping not found';
  end if;

  if not exists (
    select 1 from public.user_profiles
    where user_id = v_user_id and status = 'active'
  ) then
    raise exception 'Expected active user_profiles row not found';
  end if;

  if not exists (
    select 1 from public.employees
    where id = v_employee_id
      and name = 'Yungyeong Jang'
      and company_id = 'ea2925b2-5d7d-4dd2-9086-1a3a51ccbcc5'
      and is_active = true
  ) then
    raise exception 'Expected active employee mapping not found';
  end if;

  select employee_id into v_existing_employee
  from public.employee_user_links
  where user_id = v_user_id;

  select user_id into v_existing_user
  from public.employee_user_links
  where employee_id = v_employee_id;

  if v_existing_employee is not null and v_existing_employee <> v_employee_id then
    raise exception 'User is already linked to another employee';
  end if;
  if v_existing_user is not null and v_existing_user <> v_user_id then
    raise exception 'Employee is already linked to another user';
  end if;

  if v_existing_employee is null and v_existing_user is null then
    insert into public.employee_user_links (employee_id, user_id)
    values (v_employee_id, v_user_id);
  end if;
end $$;

commit;
```

The SQL creates only the required link. It does not create an Auth user, change profile status, add section access, add HR/company/global roles, change RLS, or change table privileges. Since the profile already exists and is active, a profile insert is intentionally omitted.

## 6. Is `/api/employee-portal/me/hr?year=YYYY` safe to implement?

**Yes — safe to implement in code after this explicit parity decision, but not yet safe to activate for the pilot.**

Implementation guardrails:

- dedicated portal authorization helper, not `authorizeHrRequest`;
- server-side service-role lookup only;
- session UUID → active `user_profiles` → exactly one `employee_user_links` row → employee ID;
- ignore/reject client `employeeId`, `companyId`, and arbitrary `userId`;
- no portal POST/PATCH/DELETE handlers;
- use EmployeeSearch canonical balance semantics above;
- execute the assignment SQL only in a separately approved Production change window, then run isolation tests.

The endpoint should remain fail-closed until the link SQL is explicitly executed and verified.
