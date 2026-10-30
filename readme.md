# Police vs Protestors

A small browser game in plain ES5 JavaScript. Classic `<script>` tags only (no
modules, no bundler), so it runs straight from disk.

## How to run

Double-click `index.html`. There is no build step and no server needed.

Tests run headless with node:

```
node test_police.js
node test_escort.js
```

`node check_map.js` validates the map grid and that the plaza is reachable from
the crowd spawn.

## The goal

The crowd marches from the map edges toward the plaza. Protesters filling the
streets is fine - that is not a failure. The police job is to keep the city safe
by arresting the violent rioters and looters hidden inside the crowd. Arresting
an innocent protester is a wrong arrest and angers the crowd around it.

## Planning phase

Press Enter on the title screen to reach the planning screen. The match has not
started and time is frozen.

- Click a green street tile to place the selected squad there.
- Keys `1` to `6` select a squad.
- `V` cycles the selected squad's loadout, skipping any option that would go
  over the budget.
- `B` then click places a barrier.
- `Enter` starts the match.

The top-left panel shows `Budget used X / 10` and one line per squad with its
loadout.

## Loadouts

Every squad has a loadout. Costs come from `CONFIG.loadouts`, the total is
capped by `CONFIG.loadoutBudget` (10):

| loadout | cost | what it gives the squad |
| --- | --- | --- |
| none | 0 | 4 officers on foot |
| car | 2 | 4 officers + police car, enables the loudspeaker |
| watertruck | 3 | 4 officers + water truck, enables the water cannon |
| barriertruck | 2 | 4 officers + barrier truck, enables barriers (3 per truck) |
| motorbike | 2 | 2 fast officers, no big vehicle |

Default loadouts: squad 1 car, squad 2 watertruck, squad 3 barriertruck,
squad 4 motorbike, squads 5 and 6 none.

Tools belong to squads, not to the player globally:

- Barriers need the selected squad to have a barrier truck with stock left.
- The water cannon needs the selected squad to have a water truck.
- The loudspeaker needs the selected squad to have a car.

## In-match keys

- Click: move the selected squad there. Shift+click: run (limited by stamina).
- `1`-`6`: select a squad.
- `S`: toggle calm / firm stance.
- `B` then click: place a barrier.
- `L` then click: loudspeaker (calms the crowd nearby).
- `W` then click: water cannon.
- `Space`: pause.
- `T`: toggle 1x / 2x speed.
- `Esc`: cancel barrier / loudspeaker / water mode.
- `R` on the debrief screen: restart.

## How arrests work

Officers observe agents inside their observation radius. Suspicion rises only
from visible violence: carrying a tool, being revealed, or a recent violent act
such as smashing a shop or throwing something. Mood alone - however high, and
even in the "agitated" state - never makes anyone arrestable. Suspicion decays
when an agent is out of sight.

A squad's leader picks the highest-suspicion agent at or above the threshold,
the squad walks over and holds for a moment, then the arrest completes. If the
target was a rioter it counts as a correct arrest; if it was a peaceful
protester it is a wrong arrest and pushes the mood of everyone nearby up.

## Files

- `index.html` - the page; loads the five scripts in order.
- `style.css` - dark page background and canvas centring.
- `map.js` - `MAP`: width, height, row strings, shops, crowd spawn, plaza centre.
- `crowd.js` - `Crowd`: agents, mood, flow field, rioters, arrests, loudspeaker.
- `police.js` - `Police`: squads, loadouts, vehicles, suspicion, arrests, tools.
- `ui.js` - `UI`: title, planning and debrief screens, HUD, input handling.
- `game.js` - `CONFIG`, `makeG()`, the main loop, canvas sizing, map drawing.
- `test_police.js` - headless police/squad/loadout tests.
- `test_escort.js` - headless arrest-to-escort tests.
- `test_sim.js` - headless crowd-only scenarios.
- `check_map.js` - map grid and reachability check.
- `.gitignore` - ignore rules.