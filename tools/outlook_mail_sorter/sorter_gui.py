from __future__ import annotations

import ctypes
import json
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from tkinter import END, StringVar, Tk, messagebox, ttk
import tkinter as tk


SCRIPT_DIR = Path(__file__).resolve().parent
REPORTS_DIR = SCRIPT_DIR / "reports"
APP_BG = "#F3F6FB"
CARD_BG = "#FFFFFF"
ACCENT = "#1D4ED8"
ACCENT_SOFT = "#DBEAFE"
TEXT = "#0F172A"
MUTED = "#475569"
BORDER = "#D7DFEA"
RUN_ACTIONS = {
    "전체 실행 (분류 + Done 정리)": ["all"],
    "미리보기 실행 (Dry Run)": ["all", "--dry-run"],
    "폴더 경로 확인": ["folders"],
    "Done 폴더만 정리": ["sort-done"],
    "분류만 실행": ["classify"],
    "Inbox 특수 규칙만 실행": ["sort-inbox"],
    "회사별 Done 재정리": ["rebalance-done"],
}
DEFAULT_CONFIGS = {
    "Yungyeong": {
        "config": SCRIPT_DIR / "config.json",
        "token_cache": SCRIPT_DIR / ".token_cache.json",
        "task": "Outlook Mail Sorter",
        "register": SCRIPT_DIR / "register_task.ps1",
    },
    "Admin AFS": {
        "config": SCRIPT_DIR / "config.admin-afs.json",
        "token_cache": SCRIPT_DIR / ".token_cache.admin-afs.json",
        "task": "Outlook Mail Sorter Admin AFS",
        "register": SCRIPT_DIR / "register_task_admin_afs.ps1",
    },
}
FIELD_LABELS = {
    "domains": "도메인",
    "recipient_domains": "수신자 도메인",
    "senders": "발신자",
    "to_or_cc": "받는사람/참조",
    "recipients": "수신자",
    "subject_contains": "제목 키워드",
    "body_contains": "본문 미리보기 키워드",
    "subject_or_body_contains": "제목/본문 공통 키워드",
    "add_categories": "추가 카테고리",
}
SPECIAL_RULE_DESCRIPTIONS = {
    "Hydrofarm Jessica Admin": "Hydrofarm Jessica 메일이면 Admin 폴더로 보냅니다.",
    "HelloFresh": "HelloFresh 관련 메일이면 Inbox에서도 바로 HelloFresh 폴더로 보낼 수 있습니다.",
    "Data Dock / Rose Rocket Tender": "Rose Rocket, Data Dock, Tender 관련 메일을 전용 폴더로 보냅니다.",
    "Fuel Surcharge": "제목에 fuel surcharge가 있으면 비활성 ETC 폴더로 보냅니다.",
    "HR Keywords - Subject": "제목에 휴가, 병가, 급여, 초과근무 같은 HR 키워드가 있으면 HR 폴더로 보냅니다.",
    "HR Keywords - Body Review": "본문 미리보기에 HR 키워드가 있으면 자동 이동하지 않고 Review Needed만 붙입니다.",
    "Jan-Pro": "Jan-Pro 관련 메일이면 청소업체 폴더로 보냅니다.",
    "Deel / ZFS Payroll": "Deel 관련 메일을 ZFS Payroll 폴더로 보내고 ZFS 회사 태그를 강제로 붙입니다.",
    "DocuSign": "DocuSign 완료/서명 메일이면 계약서 폴더로 보냅니다.",
    "OpenDock Inactive": "OpenDock 알림 메일을 읽음 처리 후 비활성 폴더로 보냅니다.",
    "GCC Inactive": "GCC 관련 메일을 읽음 처리 후 비활성 폴더로 보냅니다.",
    "JCtrans Inactive": "JCtrans 관련 메일을 읽음 처리 후 비활성 폴더로 보냅니다.",
    "ElevenLabs Admin IT": "ElevenLabs 관련 메일을 Admin IT 폴더로 보냅니다.",
    "MTDirect Password Expiry Inactive": "비밀번호 만료 알림 메일을 읽음 처리 후 비활성 폴더로 보냅니다.",
    "18 Wheels Operation": "18 Wheels 관련 메일을 운영 폴더로 보냅니다.",
    "E2Open Admin IT": "E2Open 관련 메일을 Admin IT 폴더로 보냅니다.",
    "Sales Recipients": "영업팀 주소가 수신자에 있으면 Sales 폴더로 보냅니다.",
    "Accounting Recipients": "회계팀 주소가 수신자에 있으면 Accounting 폴더로 보냅니다.",
    "Operation Recipients": "운영팀 주소가 수신자에 있으면 Operation 폴더로 보냅니다.",
}
COMPANY_EXPLANATIONS = {
    "ZFS": "ZFS 회사로 판단되면 ZFS 카테고리를 붙입니다.",
    "TNT": "TNT 회사로 판단되면 TNT 카테고리를 붙입니다.",
    "AFS": "AFS 회사로 판단되면 AFS 카테고리를 붙입니다.",
}


def enable_high_dpi() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


class SorterGui:
    def __init__(self) -> None:
        enable_high_dpi()
        self.root = Tk()
        self.root.tk.call("tk", "scaling", self.root.winfo_fpixels("1i") / 72.0)
        self.root.title("Outlook Mail Sorter")
        self.root.geometry("1260x860")
        self.root.minsize(1040, 700)
        self.root.configure(bg=APP_BG)

        self.profile = StringVar(value="Yungyeong")
        self.schedule_time = StringVar(value="08:15")
        self.run_action = StringVar(value="전체 실행 (분류 + Done 정리)")
        self.rules_scope = StringVar(value="우선순위 순")
        self.config_path = DEFAULT_CONFIGS[self.profile.get()]["config"]
        self.config: dict = {}
        self.path_vars: dict[str, StringVar] = {}
        self.rules_views: dict[str, tk.Text] = {}

        self._configure_styles()
        self._build()
        self.load_config()
        self.refresh_status()

    def _configure_styles(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("vista")
        except Exception:
            pass
        style.configure("App.TFrame", background=APP_BG)
        style.configure("Card.TFrame", background=CARD_BG, relief="flat")
        style.configure("CardTitle.TLabel", background=CARD_BG, foreground=TEXT, font=("맑은 고딕", 11, "bold"))
        style.configure("Body.TLabel", background=CARD_BG, foreground=MUTED, font=("맑은 고딕", 10))
        style.configure("Top.TLabel", background=APP_BG, foreground=TEXT, font=("맑은 고딕", 10, "bold"))
        style.configure("Top.TButton", font=("맑은 고딕", 10), padding=(10, 6))
        style.configure("Accent.TButton", font=("맑은 고딕", 10, "bold"), padding=(12, 7))
        style.map("Accent.TButton", background=[("active", ACCENT), ("!disabled", ACCENT_SOFT)])
        style.configure("TNotebook", background=APP_BG, borderwidth=0)
        style.configure("TNotebook.Tab", padding=(12, 8), font=("맑은 고딕", 10))
        style.map("TNotebook.Tab", background=[("selected", CARD_BG)], foreground=[("selected", TEXT)])
        style.configure("TLabelframe", background=CARD_BG)
        style.configure("TLabelframe.Label", background=CARD_BG, foreground=TEXT, font=("맑은 고딕", 10, "bold"))

    def _build(self) -> None:
        shell = ttk.Frame(self.root, style="App.TFrame", padding=14)
        shell.pack(fill="both", expand=True)

        top = ttk.Frame(shell, style="App.TFrame")
        top.pack(fill="x", pady=(0, 10))

        ttk.Label(top, text="프로필", style="Top.TLabel").pack(side="left")
        profile_box = ttk.Combobox(top, textvariable=self.profile, values=list(DEFAULT_CONFIGS), state="readonly", width=16)
        profile_box.pack(side="left", padx=(10, 16))
        profile_box.bind("<<ComboboxSelected>>", lambda _event: self.switch_profile())

        ttk.Button(top, text="설정 다시 불러오기", command=self.load_config, style="Top.TButton").pack(side="left", padx=4)
        ttk.Button(top, text="설정 저장", command=self.save_config, style="Top.TButton").pack(side="left", padx=4)
        ttk.Button(top, text="리포트 폴더 열기", command=lambda: self.run_detached(["explorer", str(REPORTS_DIR)]), style="Top.TButton").pack(side="left", padx=4)

        notebook = ttk.Notebook(shell)
        notebook.pack(fill="both", expand=True)

        self.run_tab = ttk.Frame(notebook, style="App.TFrame", padding=12)
        self.config_tab = ttk.Frame(notebook, style="App.TFrame", padding=12)
        self.rules_tab = ttk.Frame(notebook, style="App.TFrame", padding=12)
        self.schedule_tab = ttk.Frame(notebook, style="App.TFrame", padding=12)
        notebook.add(self.run_tab, text="실행")
        notebook.add(self.config_tab, text="폴더 설정")
        notebook.add(self.rules_tab, text="규칙 보기")
        notebook.add(self.schedule_tab, text="예약 실행")

        self._build_run_tab()
        self._build_config_tab()
        self._build_rules_tab()
        self._build_schedule_tab()

    def _card(self, parent: ttk.Frame, title: str, subtitle: str | None = None) -> ttk.Frame:
        card = ttk.Frame(parent, style="Card.TFrame", padding=14)
        card.pack(fill="both", expand=True)
        ttk.Label(card, text=title, style="CardTitle.TLabel").pack(anchor="w")
        if subtitle:
            ttk.Label(card, text=subtitle, style="Body.TLabel", wraplength=1080, justify="left").pack(anchor="w", pady=(4, 10))
        return card

    def _scrolled_text(self, parent: ttk.Frame, height: int = 18) -> tk.Text:
        wrap = ttk.Frame(parent, style="Card.TFrame")
        wrap.pack(fill="both", expand=True)
        text = tk.Text(
            wrap,
            wrap="word",
            height=height,
            bg="#FCFDFE",
            fg=TEXT,
            relief="solid",
            borderwidth=1,
            highlightthickness=0,
            padx=12,
            pady=10,
            font=("맑은 고딕", 11),
        )
        ybar = ttk.Scrollbar(wrap, orient="vertical", command=text.yview)
        text.configure(yscrollcommand=ybar.set)
        text.pack(side="left", fill="both", expand=True)
        ybar.pack(side="right", fill="y")
        return text

    def _build_run_tab(self) -> None:
        card = self._card(
            self.run_tab,
            "실행 패널",
            "자주 쓰는 실행 동작을 한곳에 모았습니다. 미리보기로 확인한 뒤 실제 실행하는 흐름을 권장합니다.",
        )

        controls = ttk.Frame(card, style="Card.TFrame")
        controls.pack(fill="x", pady=(0, 10))
        ttk.Label(controls, text="실행 항목", style="Top.TLabel").pack(side="left")
        ttk.Combobox(controls, textvariable=self.run_action, values=list(RUN_ACTIONS), state="readonly", width=30).pack(side="left", padx=(8, 8))
        ttk.Button(controls, text="선택한 작업 실행", command=self.run_selected_action, style="Accent.TButton").pack(side="left", padx=4)
        ttk.Button(controls, text="Inbox 브리핑 만들기", command=self.run_briefing, style="Top.TButton").pack(side="left", padx=4)

        self.output = self._scrolled_text(card, height=24)

    def _build_config_tab(self) -> None:
        card = self._card(self.config_tab, "폴더 설정", "현재 프로필에서 사용하는 Inbox, Done, 회사별/특수 목적지 폴더를 수정할 수 있습니다.")
        canvas = tk.Canvas(card, bg=CARD_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(card, orient="vertical", command=canvas.yview)
        self.config_form = ttk.Frame(canvas, style="Card.TFrame")
        self.config_form.bind("<Configure>", lambda _event: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self.config_form, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

    def _build_rules_tab(self) -> None:
        outer = self._card(
            self.rules_tab,
            "규칙 뷰어",
            "규칙을 폴더별로 나눠 보고, 우선순위 순서대로도 확인할 수 있습니다. 스크롤바는 항상 표시됩니다.",
        )

        topbar = ttk.Frame(outer, style="Card.TFrame")
        topbar.pack(fill="x", pady=(0, 10))
        ttk.Label(topbar, text="정렬 방식", style="Top.TLabel").pack(side="left")
        scope_box = ttk.Combobox(topbar, textvariable=self.rules_scope, values=["우선순위 순", "이름 순"], state="readonly", width=16)
        scope_box.pack(side="left", padx=(8, 0))
        scope_box.bind("<<ComboboxSelected>>", lambda _event: self.render_rules_view())

        self.rules_notebook = ttk.Notebook(outer)
        self.rules_notebook.pack(fill="both", expand=True)
        for key, title in [
            ("overview", "전체 개요"),
            ("priority", "우선순위"),
            ("inbox", "Inbox 규칙"),
            ("done", "Done 규칙"),
            ("company", "회사 태그 규칙"),
        ]:
            frame = ttk.Frame(self.rules_notebook, style="Card.TFrame", padding=8)
            self.rules_notebook.add(frame, text=title)
            self.rules_views[key] = self._scrolled_text(frame, height=23)

    def _build_schedule_tab(self) -> None:
        card = self._card(self.schedule_tab, "예약 실행", "정기 실행 스케줄을 등록하고 현재 상태를 바로 확인할 수 있습니다.")
        row = ttk.Frame(card, style="Card.TFrame")
        row.pack(fill="x", pady=(0, 10))
        ttk.Label(row, text="평일 실행 시간", style="Top.TLabel").pack(side="left")
        ttk.Entry(row, textvariable=self.schedule_time, width=10).pack(side="left", padx=8)
        ttk.Button(row, text="예약 등록 / 수정", command=self.register_schedule, style="Top.TButton").pack(side="left", padx=4)
        ttk.Button(row, text="예약 작업 지금 실행", command=self.start_task, style="Top.TButton").pack(side="left", padx=4)
        ttk.Button(row, text="상태 새로고침", command=self.refresh_status, style="Top.TButton").pack(side="left", padx=4)
        self.status = self._scrolled_text(card, height=20)

    def switch_profile(self) -> None:
        self.config_path = DEFAULT_CONFIGS[self.profile.get()]["config"]
        self.schedule_time.set("08:20" if self.profile.get() == "Admin AFS" else "08:15")
        self.load_config()
        self.refresh_status()

    def load_config(self) -> None:
        try:
            self.config = json.loads(self.config_path.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            messagebox.showerror("설정 불러오기 실패", str(exc))
            return
        self.render_config_form()
        self.render_rules_view()
        self.log(f"불러옴: {self.config_path.name}")

    def render_config_form(self) -> None:
        for child in self.config_form.winfo_children():
            child.destroy()
        self.path_vars.clear()

        folders = self.config.get("folders", {})
        rows: list[tuple[str, str, str]] = [
            ("Inbox 폴더", "folders.inbox", folders.get("inbox", "")),
            ("공용 Done 폴더", "folders.done", folders.get("done", "")),
        ]
        for company, path in folders.get("done_by_company", {}).items():
            rows.append((f"{company} Done 폴더", f"folders.done_by_company.{company}", path))
        for key, path in folders.get("special_destinations", {}).items():
            rows.append((f"특수 목적지: {key}", f"folders.special_destinations.{key}", path))

        for index, (label, key, value) in enumerate(rows):
            ttk.Label(self.config_form, text=label, style="Top.TLabel").grid(row=index, column=0, sticky="w", pady=6)
            var = StringVar(value=value)
            self.path_vars[key] = var
            ttk.Entry(self.config_form, textvariable=var, width=82).grid(row=index, column=1, sticky="ew", pady=6, padx=(12, 0))
        self.config_form.columnconfigure(1, weight=1)

    def save_config(self) -> None:
        folders = self.config.setdefault("folders", {})
        for key, var in self.path_vars.items():
            parts = key.split(".")
            if parts[1] in ("inbox", "done"):
                folders[parts[1]] = var.get().strip()
            elif parts[1] == "done_by_company":
                folders.setdefault("done_by_company", {})[parts[2]] = var.get().strip()
            elif parts[1] == "special_destinations":
                folders.setdefault("special_destinations", {})[parts[2]] = var.get().strip()
        self.config_path.write_text(json.dumps(self.config, indent=4, ensure_ascii=False), encoding="utf-8")
        self.render_rules_view()
        self.log(f"저장됨: {self.config_path.name}")

    def current_profile(self) -> dict:
        return DEFAULT_CONFIGS[self.profile.get()]

    def python_exe(self) -> str:
        venv = SCRIPT_DIR / ".venv" / "Scripts" / "python.exe"
        return str(venv if venv.exists() else "python")

    def sorter_base_cmd(self) -> list[str]:
        profile = self.current_profile()
        return [
            self.python_exe(),
            str(SCRIPT_DIR / "outlook_mail_sorter.py"),
            "--config",
            str(profile["config"]),
            "--token-cache",
            str(profile["token_cache"]),
        ]

    def run_selected_action(self) -> None:
        action = RUN_ACTIONS.get(self.run_action.get())
        if not action:
            messagebox.showerror("실행 항목", "올바른 실행 항목을 선택해 주세요.")
            return
        self.run_sorter(action)

    def run_sorter(self, args: list[str]) -> None:
        self.run_command(self.sorter_base_cmd() + args)

    def run_briefing(self) -> None:
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        output = REPORTS_DIR / f"inbox-briefing-{stamp}.md"
        self.run_command([
            self.python_exe(),
            str(SCRIPT_DIR / "inbox_briefing.py"),
            "--self-email",
            "yungyeong.j@afstransco.com",
            "--output",
            str(output),
        ])

    def register_schedule(self) -> None:
        profile = self.current_profile()
        self.run_powershell([str(profile["register"]), "-At", self.schedule_time.get().strip()], target=self.status)

    def start_task(self) -> None:
        self.run_powershell(["Start-ScheduledTask", "-TaskName", self.current_profile()["task"]], target=self.status)

    def refresh_status(self) -> None:
        task = self.current_profile()["task"]
        command = f"Get-ScheduledTaskInfo -TaskName '{task}' | Format-List *"
        self.run_powershell(["-Command", command], target=self.status, clear=True)

    def run_powershell(self, args: list[str], target: tk.Text, clear: bool = False) -> None:
        if args and args[0].endswith(".ps1"):
            cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", *args]
        else:
            cmd = ["powershell.exe", "-NoProfile", *args]
        self.run_command(cmd, target=target, clear=clear)

    def run_command(self, cmd: list[str], target: tk.Text | None = None, clear: bool = False) -> None:
        box = target or self.output
        if clear:
            box.delete("1.0", END)
        self.append(box, f"> {' '.join(cmd)}\n")

        def worker() -> None:
            process = subprocess.Popen(
                cmd,
                cwd=SCRIPT_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            assert process.stdout is not None
            for line in process.stdout:
                self.root.after(0, self.append, box, line)
            code = process.wait()
            self.root.after(0, self.append, box, f"\n종료 코드: {code}\n")

        threading.Thread(target=worker, daemon=True).start()

    def run_detached(self, cmd: list[str]) -> None:
        subprocess.Popen(cmd, cwd=SCRIPT_DIR)

    def append(self, box: tk.Text, text: str) -> None:
        box.insert(END, text)
        box.see(END)

    def log(self, text: str) -> None:
        if hasattr(self, "output"):
            self.append(self.output, f"{text}\n")

    def render_rules_view(self) -> None:
        if not self.rules_views:
            return
        runtime = self.config.get("runtime", {})
        folders = self.config.get("folders", {})
        company_rules = list(self.config.get("company_rules", []))
        special_rules = list(self.config.get("special_move_rules", []))
        if self.rules_scope.get() == "이름 순":
            company_rules.sort(key=lambda rule: rule.get("company", ""))
            special_rules.sort(key=lambda rule: rule.get("name", ""))

        overview_lines = [
            f"프로필: {self.profile.get()}",
            f"설정 파일: {self.config_path.name}",
            "",
            "[현재 실행 범위]",
            f"- Inbox 분류: {self.bool_text(runtime.get('classify_inbox', True))}",
            f"- Inbox 미분류만 태그: {self.bool_text(runtime.get('classify_inbox_only_when_missing_company', False))}",
            f"- Inbox 특수 이동: {self.bool_text(runtime.get('move_inbox', False))}",
            f"- Done 재분류: {self.bool_text(runtime.get('classify_done', False))}",
            f"- Done 이동: {self.bool_text(runtime.get('move_done', True))}",
            f"- page_size: {runtime.get('page_size', '')}",
            f"- 회사 우선순위: {', '.join(runtime.get('company_categories', [])) or '(없음)'}",
            f"- 유지 카테고리: {', '.join(runtime.get('preserve_categories', [])) or '(없음)'}",
            "",
            "[폴더]",
            f"- Inbox: {folders.get('inbox', '')}",
            f"- 공용 Done: {folders.get('done', '')}",
        ]

        priority_lines = [
            "[회사 태그 우선순위]",
            *[f"{index}. {company}" for index, company in enumerate(runtime.get("company_categories", []), start=1)],
            "",
            "[특수 규칙 우선순위]",
            "아래 순서대로 먼저 검사됩니다.",
        ]
        for index, rule in enumerate(special_rules, start=1):
            priority_lines.append(f"{index}. {rule.get('name', f'규칙 {index}')} -> {self.rule_destination_text(rule)}")

        inbox_lines = [
            "[Inbox에 적용되는 규칙]",
            f"- 회사 태그 규칙 사용: {self.bool_text(runtime.get('classify_inbox', True))}",
            f"- 특수 이동 규칙 사용: {self.bool_text(runtime.get('move_inbox', False))}",
            "",
            "[Inbox 회사 태그 규칙]",
        ]
        for rule in company_rules:
            inbox_lines.extend(self.format_company_rule(rule))
            inbox_lines.append("")
        inbox_lines.append("[Inbox 특수 이동 규칙]")
        for index, rule in enumerate(special_rules, start=1):
            inbox_lines.extend(self.format_special_rule(rule, index))
            inbox_lines.append("")

        done_lines = [
            "[Done에 적용되는 규칙]",
            f"- Done 재분류: {self.bool_text(runtime.get('classify_done', False))}",
            f"- Done 자동 이동: {self.bool_text(runtime.get('move_done', True))}",
            "",
            "[Done 이동 규칙]",
            "특수 규칙이 먼저 적용되고, 남은 메일은 회사 태그 기준으로 회사별 Done 폴더로 이동합니다.",
            "",
        ]
        for index, rule in enumerate(special_rules, start=1):
            done_lines.extend(self.format_special_rule(rule, index))
            done_lines.append("")
        done_lines.append("[회사별 Done 폴더]")
        for company, path in folders.get("done_by_company", {}).items():
            done_lines.append(f"- {company}: {path}")

        company_lines = ["[회사 태그 규칙]"]
        for rule in company_rules:
            company_lines.extend(self.format_company_rule(rule))
            company_lines.append("")

        self.fill_text("overview", overview_lines)
        self.fill_text("priority", priority_lines)
        self.fill_text("inbox", inbox_lines)
        self.fill_text("done", done_lines)
        self.fill_text("company", company_lines)

    def fill_text(self, key: str, lines: list[str]) -> None:
        view = self.rules_views[key]
        view.delete("1.0", END)
        view.insert("1.0", "\n".join(lines).strip() + "\n")

    def format_company_rule(self, rule: dict) -> list[str]:
        company = rule.get("company", "(알 수 없음)")
        lines = [f"- {company}", f"  설명: {COMPANY_EXPLANATIONS.get(company, '조건이 맞으면 이 회사 카테고리를 붙입니다.')}" ]
        for detail in self.rule_details(rule, include_destination=False):
            lines.append(f"  {detail}")
        return lines

    def format_special_rule(self, rule: dict, index: int) -> list[str]:
        name = rule.get("name", f"규칙 {index}")
        review_only = rule.get("review_only", False)
        lines = [
            f"- {index}. {name}",
            f"  동작: {'자동 이동 없이 검토 표시만 함' if review_only else self.rule_destination_text(rule)}",
            f"  설명: {SPECIAL_RULE_DESCRIPTIONS.get(name, '아래 조건이 맞으면 지정된 폴더 이동 또는 추가 처리합니다.')}",
            f"  사용 여부: {self.bool_text(rule.get('enabled', True))}",
        ]
        for detail in self.rule_details(rule, include_destination=False):
            lines.append(f"  {detail}")
        return lines

    def bool_text(self, value: bool) -> str:
        return "예" if value else "아니오"

    def rule_destination_text(self, rule: dict) -> str:
        destination_type = rule.get("destination_type")
        if rule.get("review_only"):
            return "검토 필요 표시만"
        if destination_type == "company":
            return f"회사 폴더로 이동: {rule.get('company', '')}"
        if destination_type == "special":
            return f"특수 폴더로 이동: {rule.get('destination_key', '')}"
        return "이동 없음"

    def rule_details(self, rule: dict, include_destination: bool = True) -> list[str]:
        details: list[str] = []
        if include_destination:
            details.append(f"목적지: {self.rule_destination_text(rule)}")
        if rule.get("force_company"):
            details.append(f"강제 회사 태그: {rule.get('force_company')}")
        if rule.get("mark_read"):
            details.append("추가 동작: 읽음 처리")
        for key, label in FIELD_LABELS.items():
            values = rule.get(key) or []
            if values:
                details.append(f"{label}: {', '.join(str(value) for value in values)}")
        if not details:
            details.append("조건: 별도 조건 없음")
        return details

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    SorterGui().run()


