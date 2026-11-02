# How to work on this game: Claude manages, DeepSeek codes

Paste this to start a new Claude Code session on any machine:

> Read DEEPSEEK_WORKFLOW.md and NEXT_SESSION.md in this repo and follow them. You are the manager:
> DeepSeek web writes the code through tools/dev/ds_pool.py, using all the DeepSeek accounts on this
> machine in rotation. Then: <the task>.

## Roles
- **Claude = manager, not senior engineer.** Read only the code needed to write a precise job spec, send the coding to DeepSeek, wire and test the result, fix small integration bugs, commit and push. The user wants their Claude tokens saved: don't rewrite DeepSeek's work yourself unless it is a few lines.
- **DeepSeek web = coder.** It sees only the prompt you write: game code and specs. Never put key, token or password files, or anything from them, in a prompt. `ds_pool.py` refuses prompts with credential-shaped text, and also any token from the files listed in `DS_SECRET_FILES`. Set that variable to this machine's secret files.

## Setup (once per machine)
1. `pip install playwright` (it uses the installed Edge or Chrome; set `DS_BROWSER` if neither is found).
2. Sign in each DeepSeek account once, at the machine: `python tools/dev/ds_pool.py login 1`, then `login 2`, `login 3`... Each account gets its own browser profile, `~/.deepseek-profile-N`.
3. Check each one: `python tools/dev/ds_pool.py test N` should print `account N: ok`.
4. Prompts and replies live outside the repo, in `../ppg_work/prompts/JOB.md` and `../ppg_work/replies/JOB.md` (or set `$DS_WORK`). Don't commit them.

## Sending jobs
- `python tools/dev/ds_pool.py check JOB1 JOB2`: runs the filter only.
- `python tools/dev/ds_pool.py run JOB1 JOB2 JOB3 --accounts 1,2,3 --gap 600`: each job goes to whichever account is free first. Each account rests `--gap` seconds after a job (keep 600: one account must not be asked more often than once every 10 minutes, or it gets rate-limited). With 3 accounts, 3 jobs run at the same time.
  - A rate-limited job is re-queued, and that account rests 20 minutes.
  - A logged-out account is dropped. Ask the user to run `login N` at the machine.
- Run long batches in the background and read the log. The browser is closed after every job. Check that no stray Edge or Chrome processes are left behind.
- Only send jobs in parallel when they are **independent** (different files, or different regions of one file). A job that depends on another job's output waits for it.

## Writing a job prompt (what works)
Prompts that worked are the ones from earlier jobs, such as the landmarks, overview, lines and disperse jobs. Each one has:
1. One line: "Write ONE new file, X.js, for a browser game "Police vs Protestors" (plain ES5, classic script, no modules, runs from file://)…", plus what the feature is and that you will do the wiring yourself.
2. **World facts:** the exact globals and fields it may use: MAP.rows, MAP.width/height, tile chars, the G.agents/G.officers/G.vehicles fields, `Art.project(x, y, z)`, `Crowd.fieldTo`, `G.blocked` (a **Set** of "x,y" keys), `G.log`, `G.time`. Copy them from the code; don't guess.
3. **Behaviour:** numbered and concrete: numbers, timings, probabilities, log texts.
4. **Drawing:** `Art.project`, `Art.camera.S`, ctx.save/restore.
5. **API (exact):** `var X = (function () { ... return {...}; })(); if (typeof module !== "undefined" && module.exports) module.exports = X;`
6. **Constraints:** ES5 only (no let, const, arrows, classes or template strings). **Never declare local variables named MAP, CONFIG, Art, Crowd, Police or FX**: a local `var MAP` shadowed the global and broke marches.js. Short comments.
7. **Output:** "Reply with exactly one ```js block … under 12000 characters". **Replies over about 15k characters get cut off.** Split big work into several files or several jobs.

To change part of an existing file, number regions in the prompt (`### R1 (lines 120-240)` with the code), ask for replacements in the same format, then splice them in: `python tools/dev/splice.py FILE ../ppg_work/replies/JOB.md 'R1:120-240' 'R2:300-350'`. For exact small edits from Python, use `tools/dev/edit.py` (`edit(f, [(old, new)])`; it asserts the old text occurs exactly once).

Avoid long slash-separated word lists in prompts (a/b/c/d/…). They look like credentials to the filter. Use commas.

## After a reply
1. Extract the js block into the file, then run `node -e "require('./X.js')"` for a syntax check.
2. Wire it in: script tag in index.html, update hook in game.js (after `DISPERSE.update`), init at both init sites (after `DISPERSE.init`), draw in art.js. Guard every call with `typeof X !== "undefined"`.
3. Tests must stay green: `node tests/test_police.js` (35 PASS, takes about 60 s, so never use a short timeout) and `node tests/test_escort.js` (6 PASS). City features stay gated behind citygen.js CONFIG keys, so the tests aren't affected.
4. Run it in headless Edge or Chrome (`--headless=new --allow-file-access-from-files --screenshot`). Look at the screenshot and catch console errors. Common DeepSeek bugs: shadowed globals, treating `G.blocked` as an object instead of a Set, and replies cut off at the end.
5. Commit with a clear message, then push to main so the user can use "Update and Play".

## Game facts worth knowing
- Screen: fixed 1600×1024 logical canvas; `CONFIG.tileSize = 1600 / MAP.width`. Maps must keep a 25:16 aspect: real maps are 360×230, and random city generation was removed (real maps only).
- Real maps: `tools/osm2map.py` (3.5 m per tile, road widths by class, exports `sites` landmarks) builds from Overpass JSON downloaded by `tools/osmget.py OUT lat lon width_m height_m`.
- Big-map systems: overview.js (zoomed-out chunk LOD), minimap.js, landmarks.js plus landmarks_art.js (MAP.sites; Paris props use MAP.landmarks), marches.js, and inner-crowd LOD in crowd.js. Crowd is capped at 1500 (levels.js).
- User rules (also in NEXT_SESSION.md): ES5 only; mood must never raise suspicion; fights stay non-graphic; the user's Linux laptop is weak, so keep an eye on fps.

## This Windows machine (clinemin profiles)
The DeepSeek logins live in clinemin's Edge profiles, not `~/.deepseek-profile-N`. Point ds_pool at them:
```
export DS_PROFILE_DIRS="C:\Users\qmn1\.cline\deepseek-web-v2\profile;C:\Users\qmn1\.cline\deepseek-web-v2\profiles\nn\profile;C:\Users\qmn1\.cline\deepseek-web-v2\profiles\m\profile"
export DS_WORK=/c/Users/qmn1/Desktop/ppg_work
```
Three accounts, all signed in (clinemin profiles `default`, `nn`, `m`; see `~/.cline/browser-profiles.json`). Note the extra `profile` folder inside `profiles\nn` and `profiles\m`. Use `--accounts 1,2,3`. Don't use a profile while clinemin has it open.
