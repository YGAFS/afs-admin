이번 세션은 YG 개인메일 자동화만 작업합니다.

작업 범위:
- 대상 메일함: `yungyeong.j@afstransco.com`
- 대상 설정 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\config.json`
- 대상 실행 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\run_inbox_tagging.ps1`
- 대상 예약 작업 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\register_inbox_tagging_task.ps1`
- 공용 로직 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\outlook_mail_sorter.py`
- GUI 파일: `C:\Users\nero_\OneDrive\Desktop\afs-admin\tools\outlook_mail_sorter\sorter_gui.py`

이번 세션에서 하지 말 것:
- `config.admin-afs.json` 기준으로 판단하지 말 것
- Admin AFS 전용 메일 규칙과 혼합하지 말 것
- 범위가 애매하면 먼저 YG 기준으로 해석할 것

작업 시작 원칙:
1. 먼저 현재 YG 기준 `config.json` 과 `run_inbox_tagging.ps1` 를 읽고 요약할 것
2. 지금 수정이 YG 전용인지, 공용 Python 영향이 있는지 먼저 말할 것
3. 공용 로직 수정 시 Admin AFS 쪽 영향 가능성을 한 줄로 경고할 것
4. 자동화 문제면 `reports` 폴더의 YG 관련 최신 로그부터 볼 것

이번 요청:
- 아래 요청만 처리해줘
- 다른 메일함 범위로 확장하지 마

[여기에 실제 요청 작성]
