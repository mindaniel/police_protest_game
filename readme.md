=== THE PROJECT ===
A browser game, "Police vs Protestors": plain JS, classic scripts (no modules) so index.html works by double-click. Canvas game. 60x40 tile map, 150 crowd agents, 8 hidden violent rioters, 6 shops, a plaza ("P" tiles), police squads the player will command.

Files (all in the folder above):
- index.html loads map.js, crowd.js, police.js, ui.js, game.js in that order. style.css, check_map.js also exist.
- map.js: MAP (width, height, rows[] of chars: '.' road, '#' building, 'S' shop, 'P' plaza, 'G' park, 'a' alley).
- crowd.js (21,569 bytes): DONE and tested. DO NOT EDIT. Global Crowd with init, update, draw, rebuildFlow, neighbors(G,x,y,r), arrest(G,agent), loudspeaker(G,x,y,radius,strength), averageMood(G). It reads CONFIG via a local alias (var C = CONFIG). crowd.update advances G.time (line ~515). It reads G.officers (fields x, y, stance "firm"|other). Crowd never writes agent.suspicion; police.js owns it (crowd draws a ring when suspicion > 20). Agent fields: x, y, active, role ("rioter"/other), hasTool, revealedUntil, state ("agitated" etc.), mood, suspicion, id.
- game.js (8,855 bytes): CONFIG object, makeG(), main loop frame(), initGame(), drawMap, drawDebug. G has time, agents, shops, stats {shopsDamaged, rioterArrested, wrongArrests, moodSum, moodSamples, peakMood}, blocked (Set of "x,y"), officers [], logMessages, log(). I already had qwen add CONFIG.officerSpeed 2.2, loudspeakerRadius 6, loudspeakerStrength 25 at the end of CONFIG, and Police.init (in initGame after Crowd.init/rebuildFlow), Police.update (inside the speed loop next to Crowd.update), Police.draw (after Crowd.draw), each guarded by typeof Police !== "undefined". Verified on disk, node --check passes.
- police.js (251 lines, 8,125 bytes, last written 11:25): global Police exporting init(G), update(G,dt), draw(ctx,G), moveSquad(G,squadIndex,x,y), setStance(G,squadIndex,stance), toggleStance(G,squadIndex), loudspeaker(G,x,y), placeBarrier(G,x,y). Passes node --check. Squads (CONFIG.squadCount=3 x officersPerSquad=4 = 12 officers) spawn at SPAWN {x:25,y:19}. Officer: {id, squad, x, y, stance:"calm", tx, ty, speed, busy, arrestTarget, arrestHold}. Suspicion: officers observe agents within CONFIG.observeRadiusTiles via Crowd.neighbors; +15/s for hasTool or revealedUntil > G.time, +3/s for agitated or mood >= 70, decay 2/s for unseen agents. Arrest: squad leader (first officer) picks highest-suspicion agent >= CONFIG.suspicionThreshold; two officers walk to it, hold CONFIG.arrestSeconds, then Crowd.arrest. Init sets G.barriers, G.loudspeakerReadyAt, G.over=false, G.endReason. Update returns early if G.over and sets G.over=true, endReason "time" when G.time >= CONFIG.matchSeconds. I reviewed the logic against the spec and it matches.
- test_sim.js: headless crowd test (3 scenarios, ~45 s). Still works (does not load police.js).
- test_police.js (4,770 bytes): headless police test. 4 direct tests + new test 5 (moveSquad sets homeX/homeY) + 120 s autopilot + 310 s match-end test. Last results: tests 1-4 PASS, 4-6 rioters arrested, 0 wrong arrests, 6/6 shops broken, G.over true with reason "time" in the long run. Results vary run to run (Math.random).
- ui.js (85 bytes): still a one-line STUB.

=== OPEN BUG (the immediate next step) ===
Police.moveSquad only sets each officer's tx/ty. When an arrest starts, the arrest code overwrites squad[0].tx/ty and squad[1].tx/ty with the suspect's position and nothing restores them, so those officers never return to the squad's move target.
Fix (police.js only): (1) Police.init gives each officer homeX: SPAWN.x, homeY: SPAWN.y; (2) moveSquad also sets homeX=x, homeY=y for the squad; (3) at every arrest end (cancel: target inactive/suspicion below threshold; cancel: target out of range; and right after Crowd.arrest) reset tx=homeX, ty=homeY for every squad officer in the loop that sets busy=false. Change nothing else (no CONFIG or suspicion-rate changes).
Status: test_police.js already has the updated test 2 (checks the barrier after the limit is refused) and the new test 5, so test 5 FAILS until the police.js fix lands. I sent this exact fix to chatgpt; I do not yet have its reply. Check on disk first: police.js should no longer be 8,125 bytes and `Select-String -Path police.js -Pattern 'homeX|homeY'` should hit in init, moveSquad and three arrest-end places. Then run node --check police.js and node test_police.js (about 35 s, so use -timeout 300) and confirm test 5 prints PASS.

=== STILL TO DO AFTER THAT ===
1. ui.js: HUD, planning screen, pause overlay, debrief screen, and input handling (select squad, click to move, toggle stance, place barriers, fire loudspeaker with cooldown, speed/pause). I never got the original design spec for this (tools, controls, win/lose conditions, what the planning screen does). ASK ME for the spec or a short wish list before briefing anyone. Do not invent game rules. Wire UI.init/update/draw into game.js (guarded with typeof) and keep test_sim.js and test_police.js working.
2. Game over / debrief: Police sets G.over and G.endReason at matchSeconds; the debrief should show G.stats (rioters arrested, wrong arrests, shops damaged, peak mood).
3. Balance questions to raise with me, not silently fix: all 6 shops are broken within 120 s even with police; wrong arrests were 0 in the runs I saw (suspicion rules allow them, but they never happened). Arrest counts vary between runs; a 5-run comparison was started in the background but its output never arrived.
4. Minor risk: stepToward slides along walls on single axes but an officer could still get stuck in a corner. Leave unless it shows up in testing.
5. Optional: a test that checks suspicion-driven wrong arrests can happen, and a manual browser check that index.html loads with no console errors (I cannot run a browser; ask me to open it and report).

=== YOUR FIRST MOVE ===
Ask me to paste (a) chatgpt's reply if there is one and (b) the output of this read-only check, then decide whether the homeX fix landed or needs resending:

```powershell
cd "C:\Users\quang\Downloads\police vs protestors"
Get-ChildItem police.js, test_police.js, game.js, ui.js | Select-Object Name, Length, LastWriteTime
"=== node --check ==="
foreach ($f in 'police.js','test_police.js','game.js') { "-- $f"; node --check $f 2>&1 }
"=== homeX / homeY ==="
Select-String -Path police.js -Pattern 'homeX|homeY' | ForEach-Object { "{0}: {1}" -f $_.LineNumber, $_.Line.Trim() }
```

Also ask me which assistants are currently usable, then ask me for the ui.js spec.
