이번 세션은 Admin AFS 메일 자동화만 작업합니다.

작업 범위:
- 대상 설정 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\config.admin-afs.json`
- 대상 실행 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\run_inbox_tagging.ps1`
- 대상 일일 실행 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\run_daily_admin_afs.ps1`
- 대상 예약 작업 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\register_inbox_tagging_task.ps1`
- 대상 예약 작업 등록 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\register_task_admin_afs.ps1`
- 공용 로직 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\outlook_mail_sorter.py`
- GUI 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\sorter_gui.py`

이번 세션에서 하지 말 것:
- `config.json` 기준으로 YG 개인메일 규칙을 섞지 말 것
- YG 메일 자동화 이슈와 혼합하지 말 것
- 범위가 애매하면 먼저 Admin AFS 기준으로 해석할 것

작업 시작 원칙:
1. 먼저 현재 Admin AFS 기준 `config.admin-afs.json`, `run_inbox_tagging.ps1`, `run_daily_admin_afs.ps1` 를 읽고 요약할 것
2. 지금 수정이 Admin AFS 전용인지, 공용 Python 영향이 있는지 먼저 말할 것
3. 공용 로직 수정 시 YG 개인메일 쪽 영향 가능성을 한 줄로 경고할 것
4. 자동화 문제면 `reports` 폴더의 Admin AFS 관련 최신 로그부터 볼 것

이번 요청:
- 아래 요청만 처리해줘
- 다른 메일함 범위로 확장하지 마

[여기에 실제 요청 작성]
