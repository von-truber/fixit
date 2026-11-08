# Fixit demo kit

Real-world examples for every use case, ready to paste or drop into **https://fixit-errors.netlify.app**. Each one was checked against the live site: every example answered on the first try in 3.5 to 6 seconds.

Where it's safe, there's also a **"make it real"** command that produces the error on your own machine, so the audience watches a real failure happen before Fixit explains it.

- **`.txt` files** go in **fixit explain**: open the file, copy all, paste, press **▶ RUN**.
- **`.log` files** go in **fixit logs**: drag the file onto the input card, or click **browse**.

> All names, keys, passwords and hosts in these files are made up. The API key is labelled `FAKE`.

---

## 1. The student or beginner developer

### 1a. "It worked on my friend's laptop" — [`01-student-missing-module.txt`](01-student-missing-module.txt)

A student clones a project and runs it; Python can't find `pandas`.

**Make it real** (a fresh virtual environment has no packages):

```bash
python -m venv fixit-demo-env && fixit-demo-env/bin/python -c "import pandas"
```

On Windows PowerShell:

```powershell
python -m venv fixit-demo-env; .\fixit-demo-env\Scripts\python -c "import pandas"
```

**Point out:**
- One-line summary a beginner understands: *"Python cannot find the pandas library, so the script stops before it runs."*
- It spots the `(.venv)` in the prompt and installs into that environment with `python -m pip install pandas`.
- The privacy strip says **1 secret caught**: the user name in `/home/maya/...` became `/home/[USER]/...`.

### 1b. The classic first-week bug — [`02-student-type-error.txt`](02-student-type-error.txt)

`input()` returns text, so `age + 1` fails.

**Make it real:**

```bash
python -c "age = input('How old are you? '); print('Next year you will be ' + age + 1)"
```

**Point out:**
- No jargon: *"Your code adds a number to text, which Python does not allow."*
- It gives the exact line to change (`age = int(input(...))`), not a lecture.
- Tick the steps off to show the quest progress bar and the **+25 XP BUG SQUASHED** pop-up.

---

## 2. Someone who doesn't code

### 2a. The blog that went blank — [`03-everyday-wordpress.txt`](03-everyday-wordpress.txt)

A small-business owner's WordPress site shows *"Error establishing a database connection"*.

**Point out:**
- It checks the database service is running, then the `wp-config.php` settings, then the error log.
- Every `sudo` command has a red **⚠ HAZARD** badge and a warning line. Fixit adds these itself as a safety net, even when the model forgets.

### 2b. The app that won't open — [`04-everyday-missing-dll.txt`](04-everyday-missing-dll.txt)

Zoom won't start on Windows: *"MSVCP140.dll was not found"*.

**Point out:**
- Plain steps a non-technical person can follow: install the Microsoft Visual C++ Redistributable, then repair the app.
- The last-resort system repair (`sfc /scannow`) is flagged as a HAZARD.

---

## 3. The developer in a hurry

### 3a. The rejected push — [`05-dev-git-push-rejected.txt`](05-dev-git-push-rejected.txt)

`git push` is rejected because a teammate pushed first.

**Make it real** (creates a throwaway repo in a new folder):

```bash
mkdir fixit-git-demo && cd fixit-git-demo && git init -q --bare origin.git && git clone -q origin.git a && git clone -q origin.git b && git -C a commit -q --allow-empty -m one && git -C a push -q origin HEAD:main && git -C b commit -q --allow-empty -m two && git -C b push origin HEAD:main
```

**Point out:**
- The safe fix comes first: pull the remote changes (`git pull` or `git pull --rebase`), resolve any conflicts, push again. No `--force`.
- Any force-push Fixit ever suggests is flagged as a HAZARD automatically, by the server, not just the model.

### 3b. The port that's already taken — [`06-dev-port-in-use.txt`](06-dev-port-in-use.txt)

The dev server won't start: `EADDRINUSE :::3000`.

**Make it real** (starts two servers on the same port; the second one crashes):

```bash
node -e "const h=require('http'); h.createServer().listen(3000); h.createServer().listen(3000)"
```

**Point out:**
- It finds what's using the port (`lsof -i :3000`), stops it with `kill PID`, or offers another port (`PORT=3001 npm run dev`).
- If it suggests force-killing (`kill -9`), that step is flagged as a HAZARD.

---

## 4. The support or ops engineer (Log Digest)

### 4a. The database that ran out of connections — [`08-ops-database-connections.log`](08-ops-database-connections.log)

An API starts timing out after a deploy; Postgres starts refusing clients. 161 lines.

**Point out:**
- The trim line: **161 lines → 13 sent**. Repeats are folded with exact counts before anything is sent.
- Grouped enemies with HP bars: **requests timing out ×59**, **too many clients ×9**, **pool nearly saturated ×28**.
- Root cause: *"97 of 100 connections 'idle in transaction'"*, meaning transactions are opened and never closed: a connection leak.
- Click **⚔ explain this** on the top issue to get step-by-step fixes. That unlocks the **Boss Hunter** achievement.

### 4b. The pod that keeps crashing — [`09-ops-kubernetes-crashloop.log`](09-ops-kubernetes-crashloop.log)

`kubectl get pods`, `describe` and `logs` output for a `CrashLoopBackOff`.

**Point out:**
- It cuts through 7 restarts of noise to the one line that matters: `Cannot find module '/app/dist/server.js'`.
- Root cause: the build didn't produce `dist/`, or the Dockerfile didn't copy it. *"An image content problem rather than a cluster problem."*

---

## 5. The team lead or teacher

### 5a. The red CI build — [`10-team-ci-failure.log`](10-team-ci-failure.log)

A pull request's GitHub Actions run fails at `npm ci`.

**Point out:**
- Root cause in one sentence: the PR changed `package.json` without regenerating `package-lock.json`.
- Press **copy as markdown** and paste it into the PR or a chat. It becomes a tidy write-up with headings, counts and next steps.

---

## 6. The privacy moment (any audience)

### [`07-privacy-secrets-in-error.txt`](07-privacy-secrets-in-error.txt)

A Django error that accidentally includes an `.env` dump: a database URL with a password, an AWS key, an API key, a bearer token, an email, IPs and a home folder.

**Before pressing Run:**
- The privacy strip shows **9 secrets caught**: 1 connection string, 2 API keys, 1 password, 1 auth header, 1 email, 2 IP addresses and 1 user name.
- Open **cat payload.txt** to show exactly what will be sent: `postgres://[REDACTED]@[IP]:5432/billing`, `AWS_ACCESS_KEY_ID=[API_KEY]` and so on.

**After:** Fixit still diagnoses the problem from the redacted text: *"Django could not log in to the PostgreSQL database because the password was rejected."*

---

## Suggested running orders

**90 seconds** (judges):
1. **Hook (10 s).** "Error messages are written for machines. Fixit translates them for humans."
2. **2a (25 s).** Paste the WordPress error; show the plain summary and the HAZARD badges on the `sudo` steps.
3. **6 (15 s).** Paste the secrets file and show "9 secrets caught" and the preview.
4. **4a (30 s).** Drop the database log; show "161 lines → 13 sent", the ×59 enemy, the root cause, then **⚔ explain this**.
5. **Close (10 s).** Point at the XP bar and achievements: "Free, no sign-up, live now."

**5 minutes** (a wider audience): go through the sections in order (1a, 1b, 2a, 3a, 4a, 5a, 6). Tick off steps along the way so the XP bar levels up during the talk.

## Tips

- **Rate limit:** 10 analyses per minute per visitor. In a fast demo, pace yourself; after the limit the page shows "Too many requests, try again in a minute".
- **Fresh start:** open **achievements** in the HUD and click **reset progress** to start the demo at LV 1.
- **Answers vary slightly between runs.** The wording changes; the diagnosis and the flagged commands don't.
- **Phone:** everything works on a phone too. Logs can be pasted as well as dropped.
