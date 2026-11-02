> **New sessions: read DEEPSEEK_WORKFLOW.md first** (how to assign work to DeepSeek with several accounts). The Windows paths below are from an older machine.

Continue work on my browser game "Police vs Protestors".

STATE (2026-10-30): the working copy and the real project are identical, and both are pushed to GitHub (main).

WORKING COPY (edit only this): C:\Users\qmn1\AppData\Local\Temp\3\game_bigmap
REAL PROJECT (do not touch until I approve): C:\Users\qmn1\Desktop\game
Never write to any other Temp\game_* folder.

RULES
- Plain ES5 classic scripts, no build step; must work by double-clicking index.html.
- Script order in index.html: map.js, citygen.js, crowd.js, police.js, ui.js, art.js, game.js.
- CONFIG lives in game.js and does not exist yet when the earlier files load, so read it only inside functions.
- Tests (node tests/test_police.js, expect 35/35; node tests/test_escort.js, expect 6/6) load map/game/crowd/police through vm. They do NOT load citygen.js, art.js or ui.js, and they use the fixed map in map.js. Every city-mode feature must stay switched off unless citygen.js is loaded (it sets CONFIG.rallyZones, spawnTrickleSeconds, crowdBlocksPolice, lootJoinChance and so on).
- Never make mood raise suspicion. Fights stay non-graphic (shoving only).
- Copy changes to the real project only after I approve, and first back up the real project to a dated folder.
- Edge for headless screenshots: "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --allow-file-access-from-files --user-data-dir=<new folder> --window-size=1600,1024 --timeout=5000 --screenshot=<png> <file url>. Use a new --user-data-dir for each run and never kill msedge.exe processes. To time drawing, call ctx.getImageData(0,0,1,1) after each frame, otherwise the timing only measures recording.

WHAT WAS JUST BUILT (only syntax-checked unless noted)
1. citygen.js: random city by recursive block splitting (avenues, side streets, 1-tile alleys 'a', plaza, park, small square, 4 shopping strips of 2-tile shops). CityGen.apply(seed) writes MAP and the city CONFIG keys (crowdSize 320, rioterCount 12, spawnZones, rallyZones, squadCenters, doors). game.js initGame applies a seed from ?seed= or a random one. restartGame(newCity): R replays the same city, N in planning makes a new one. Checked in node.
2. crowd.js: people spawn over time from MAP.doors and the edge zones (placeTrickle; agents have pending/spawnAt). Peaceful agents get a rally zone (assignZone/tendZone/zoneField) and wander inside it. Rioters spawn near shops. Angry bystanders can join looting. G.rioterTotal counts all rioters. People step aside for vehicles. A 200-second headless run worked, BUT all 20 shops were smashed by 160 s, so slow looting down in city mode (e.g. CONFIG.breakSeconds 7 inside CityGen.apply, fewer early rioters).
3. police.js: defaultCenter uses CONFIG.squadCenters. Vehicles park on a free tile. stepThroughCrowd slows officers and vehicles in dense crowds. orderArrest (player-chosen target; a peaceful target counts as a wrong arrest). shove(G, squad) with cooldown and G.shoveFx. moveSquad cancels an ordered arrest.
4. ui.js: left click on a squad selects it; left click on the street moves (Shift = run); hold left and drag pans (Art.panBy); right click = squad tool (water truck sprays, car loudspeaker, barrier truck barrier, foot squad arrests the person clicked or sprints there); A then click = arrest; F = shove; N = new city in planning. The planning view shows protest areas.
5. art.js (isometric renderer): static cache of ground + buildings into strips (buildCache/ensureCache/blit), plus agent sprites. Backups in the working copy: art_iso_v1.js.bak (before the cache), art_flat.js.bak (old flat renderer), ui.js.bak. The old renderer measured 80 ms per frame in headless software mode. The new one was never measured: the timing page (perf2.html#new) produced no result, so check for a JS error first. Sprites may not help in software canvas; drop them if they don't.

TODO, IN ORDER
A. Run both test files and fix any failures.
B. Load index.html in headless Edge: catch console errors, take screenshots of planning and of play after ~60 s.
C. CAMERA CHANGE (my request): I don't want the rotated diamond map with blank space around it. Fully zoomed out should show the whole map filling the screen, and dragging must never show anything outside the map. Recommended: replace the isometric projection with an axis-aligned "3/4 top-down" view (x right, y down, buildings extruded straight up, similar low-poly style and colours), with min zoom = whole map fits and the camera clamped to the map edges. Keep Art's public API (project, screenToTile, groundBegin/groundEnd, panBy, camera) so ui.js picking and overlays keep working. Depth order becomes simply by row y.
D. Performance: aim for under 16 ms per frame at ~320 agents on this machine (Windows Server, probably no GPU).
E. Balance city mode: looting pace; whether packed streets slow squads enough but not too much.
F. Then tell me to test (open index.html, Ctrl+F5) and wait for my approval before copying to the real project.
