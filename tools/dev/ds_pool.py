"""ds_pool.py - send coding jobs to DeepSeek web (chat.deepseek.com) using
SEVERAL logged-in accounts, alternating between them so no single account is
asked too often.  Linux or Windows; needs `pip install playwright` (no
`playwright install` needed: it drives the installed Edge or Chrome).

    python tools/dev/ds_pool.py login 1             # sign account 1 in (visible window, close it when done)
    python tools/dev/ds_pool.py test 1              # one tiny question on account 1
    python tools/dev/ds_pool.py check JOB [JOB...]  # run the secret filter only
    python tools/dev/ds_pool.py run JOB [JOB...] [--accounts 1,2,3] [--gap 600]

JOB = a name: prompt read from WORK/prompts/JOB.md, reply written to
WORK/replies/JOB.md.  WORK = $DS_WORK or ../ppg_work next to the repo (keep
prompts and replies OUT of the repo).  Each account gets its own browser
profile (~/.deepseek-profile-N) and debug port (9333+N).  `run` hands each job
to the account that becomes free first; an account waits --gap seconds
(default 600) after each job before its next one, and 20 min after a rate
limit (the job is re-queued).  Browsers are always closed after each job.

Secret filter: a prompt is NOT sent if it contains credential-shaped text or
any token from the files listed in $DS_SECRET_FILES (paths separated by the
OS path separator).  Never put key files in prompts.
"""
import json, os, pathlib, re, shutil, signal, subprocess, sys, threading, time

HOME = pathlib.Path.home()
REPO = pathlib.Path(__file__).resolve().parents[2]
WORK = pathlib.Path(os.environ.get("DS_WORK", REPO.parent / "ppg_work"))
URL = "https://chat.deepseek.com/"
COMPOSER = "textarea"
SHAPES = [re.compile(p, re.I) for p in (
    r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b", r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    r"\b[a-f0-9]{32,}\b", r"\b(sk|pk|rk)-[A-Za-z0-9]{16,}", r"[A-Za-z0-9+/]{40,}={0,2}",
    r"-?100\d{8,}", r"[\w.-]+@[\w-]+\.(ac\.uk|com|org|net)\b")]


def find_browser():
    for c in (os.environ.get("DS_BROWSER"), "/usr/bin/microsoft-edge", "/usr/bin/google-chrome",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              shutil.which("msedge"), shutil.which("microsoft-edge"), shutil.which("google-chrome")):
        if c and os.path.exists(c):
            return c
    sys.exit("no Edge/Chrome found: set DS_BROWSER to its path")


def check(prompt):
    bad = ["credential-shaped text (%s...)" % p.pattern[:18] for p in SHAPES if p.search(prompt)]
    for f in filter(None, os.environ.get("DS_SECRET_FILES", "").split(os.pathsep)):
        try:
            toks = {t for line in open(f, encoding="utf-8", errors="ignore")
                    for t in re.split(r"[\s=:,]+", line.strip()) if len(t) >= 8}
        except OSError:
            continue
        if any(t in prompt for t in toks):
            bad.append("contains text from a secret file")
    return bad


def parse_sse(body):
    """Answer text from a chat/completion SSE body (reasoning dropped)."""
    text, thinking, event, hints = [], False, None, []

    def frag(f):
        nonlocal thinking
        t = str((f or {}).get("type", "")).upper()
        if t == "THINK":
            thinking = True
        elif t in ("ANSWER", "RESPONSE"):
            thinking = False
        if isinstance(f, dict) and isinstance(f.get("content"), str):
            emit(f["content"])

    def emit(s):
        s = s.replace("FINISHED", "")
        if s and not thinking:
            text.append(s)

    for line in body.splitlines():
        s = line.strip()
        if s.startswith("event:"):
            event = s[6:].strip()
            continue
        if not s.startswith("data:"):
            continue
        payload = s[5:].strip()
        if not payload or payload == "[DONE]":
            event = None
            continue
        try:
            j = json.loads(payload)
        except ValueError:
            event = None
            continue
        if event == "hint":
            if j.get("type") == "error":
                hints.append(payload)
        elif isinstance(j, dict):
            p, v = j.get("p"), j.get("v")
            if isinstance(v, dict) and isinstance(v.get("response"), dict):
                r = v["response"]
                if r.get("thinking_enabled") is True:
                    thinking = True
                elif r.get("thinking_enabled") is False:
                    thinking = False
                for f in r.get("fragments") or []:
                    frag(f)
            if p == "response/fragments":
                for f in (v if isinstance(v, list) else [v]):
                    frag(f)
            if isinstance(v, str):
                emit(v)
        event = None
    return "".join(text), hints


class Account:
    def __init__(self, n, headless=True):
        self.n, self.headless = n, headless
        dirs = [d for d in os.environ.get("DS_PROFILE_DIRS", "").split(os.pathsep) if d]
        self.profile = pathlib.Path(dirs[n - 1]) if n <= len(dirs) else HOME / (".deepseek-profile-%d" % n)
        self.port = 9333 + n

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self.profile.mkdir(exist_ok=True)
        args = [find_browser(), "--user-data-dir=%s" % self.profile, "--remote-debugging-port=%d" % self.port,
                "--no-first-run", "--no-default-browser-check", "--window-size=1300,900"]
        if self.headless:
            args += ["--headless=new"]
        kw = {"creationflags": 0x200} if os.name == "nt" else {"start_new_session": True}
        self.proc = subprocess.Popen(args + ["about:blank"], stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, **kw)
        self.pw = sync_playwright().start()
        for _ in range(40):
            try:
                self.browser = self.pw.chromium.connect_over_cdp("http://127.0.0.1:%d" % self.port); break
            except Exception:
                time.sleep(0.5)
        else:
            self.__exit__(); raise RuntimeError("browser debug port did not come up")
        self.ctx = self.browser.contexts[0]
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        return self

    def __exit__(self, *exc):
        try:
            self.pw.stop()
        finally:
            try:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(self.proc.pid)], capture_output=True)
                else:
                    os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(timeout=10)
            except Exception:
                pass

    def ask(self, prompt, timeout_s=900):
        self.page.goto(URL, wait_until="domcontentloaded")
        try:
            self.page.wait_for_selector(COMPOSER, timeout=30000)
        except Exception:
            raise RuntimeError("LOGGED_OUT: run  ds_pool.py login %d" % self.n)
        box = self.page.locator(COMPOSER).first
        box.fill(prompt); time.sleep(1)
        with self.page.expect_response(lambda r: "chat/completion" in r.url, timeout=timeout_s * 1000) as info:
            box.press("Enter")
        r = info.value
        if r.status in (401, 403):
            raise RuntimeError("LOGGED_OUT: HTTP %d" % r.status)
        if r.status == 429:
            raise RuntimeError("RATE_LIMITED")
        text, hints = parse_sse(r.text())
        if not text.strip():
            raise RuntimeError("RATE_LIMITED" if any("rate_limit" in h for h in hints) else "empty reply " + " | ".join(hints)[:200])
        return text


def login(n):
    with Account(n, headless=False) as a:
        a.page.goto(URL)
        print("sign in to DeepSeek account %d in the window, then CLOSE the window" % n, flush=True)
        for _ in range(360):
            time.sleep(5)
            if a.proc.poll() is not None or not a.browser.is_connected() or not a.ctx.pages:
                break
    print(test(n))


def test(n):
    with Account(n) as a:
        return "account %d: %s" % (n, a.ask("Reply with just the word: ok", 120).strip()[:40])


FREE_FILE = WORK / "ds_free.json"   # when each account may be asked again, kept between runs


def load_free(accounts):
    try:
        saved = json.loads(FREE_FILE.read_text(encoding="utf-8"))
    except Exception:
        saved = {}
    return {n: float(saved.get(str(n), 0.0)) for n in accounts}


def save_free(n, t):
    try:
        saved = json.loads(FREE_FILE.read_text(encoding="utf-8"))
    except Exception:
        saved = {}
    saved[str(n)] = max(t, float(saved.get(str(n), 0.0)))
    FREE_FILE.parent.mkdir(parents=True, exist_ok=True)
    FREE_FILE.write_text(json.dumps(saved), encoding="utf-8")


def run(jobs, accounts, gap):
    todo, lock, free = list(jobs), threading.Lock(), load_free(accounts)
    for n in accounts:
        if free[n] > time.time():
            print("account %d rests until %s" % (n, time.strftime("%H:%M", time.localtime(free[n]))), flush=True)

    def worker(n):
        while True:
            with lock:
                if not todo:
                    return
                wait = free[n] - time.time()
            if wait > 0:
                time.sleep(min(wait, 15)); continue
            with lock:
                if not todo:
                    return
                job = todo.pop(0)
                save_free(n, time.time() + gap)   # reserve now so a parallel run skips this account
            src, dst = WORK / "prompts" / (job + ".md"), WORK / "replies" / (job + ".md")
            prompt = src.read_text(encoding="utf-8")
            print("%s acct %d -> %s (%d chars)" % (time.strftime("%H:%M"), n, job, len(prompt)), flush=True)
            try:
                with Account(n) as a:
                    text = a.ask(prompt)
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(text, encoding="utf-8")
                print("%s acct %d <- %s saved %s (%d chars)" % (time.strftime("%H:%M"), n, job, dst, len(text)), flush=True)
                free[n] = time.time() + gap
                save_free(n, free[n])
            except Exception as e:
                msg = str(e)
                print("%s acct %d !! %s: %s" % (time.strftime("%H:%M"), n, job, msg[:200]), flush=True)
                if "RATE_LIMITED" in msg:
                    with lock: todo.append(job)
                    free[n] = time.time() + 1200
                    save_free(n, free[n])
                elif "LOGGED_OUT" in msg:
                    with lock: todo.append(job)
                    return                      # drop this account
                else:
                    free[n] = time.time() + gap

    ts = [threading.Thread(target=worker, args=(n,)) for n in accounts]
    for i, t in enumerate(ts):
        t.start(); time.sleep(20 if i < len(ts) - 1 else 0)   # stagger browser starts
    for t in ts:
        t.join()
    if todo:
        print("NOT SENT (all accounts logged out):", ", ".join(todo))


def main():
    a = sys.argv[1:]
    if not a or a[0] not in ("login", "test", "check", "run"):
        sys.exit(__doc__)
    if a[0] == "login":
        return login(int(a[1]))
    if a[0] == "test":
        return print(test(int(a[1])))
    accounts, gap, jobs = [1], 600, []
    i = 1
    while i < len(a):
        if a[i] == "--accounts":
            accounts = [int(x) for x in a[i + 1].split(",")]; i += 2
        elif a[i] == "--gap":
            gap = int(a[i + 1]); i += 2
        else:
            jobs.append(a[i]); i += 1
    blocked = False
    for j in jobs:
        p = WORK / "prompts" / (j + ".md")
        bad = check(p.read_text(encoding="utf-8"))
        print("%s: %s" % (j, "BLOCKED: " + "; ".join(bad) if bad else "ok (%d chars)" % len(p.read_text(encoding="utf-8"))))
        blocked = blocked or bool(bad)
    if blocked:
        sys.exit("nothing sent: fix the blocked prompts first")
    if a[0] == "run":
        run(jobs, accounts, gap)


if __name__ == "__main__":
    main()
