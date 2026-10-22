/* map.js - static city map data for the protest scenario.
 * One character per tile. Tile legend:
 *   '.' road            (walkable)
 *   '#' building        (solid)
 *   'S' shop            (solid, breakable by rioters; see MAP.shops)
 *   'P' plaza           (walkable, protest destination)
 *   'G' park            (walkable)
 *   'a' narrow alley    (walkable, tight)
 */
var MAP = {
  tileSize: 16,
  width: 60,
  height: 40,

  /* Street plan:
   * - main boulevard: rows 19-20 (1-based), west edge -> plaza -> east edge
   * - top side street: row 9, bottom side street: rows 33-34
   * - two verticals at x=10-11 and x=48-49 linking the side streets
   * - diagonal avenue from the bottom-left up to the plaza's west corner
   * - plaza: x 27-41, y 13-27 (1-based) in the centre
   * This gives at least three west->plaza routes: boulevard, top+vertical,
   * and diagonal / bottom route.
   */
  rows: [
    "############################################################",
    "############################################################",
    "#############GGGGGG#########################################",
    "#############GGGGGG#########################################",
    "#############GGGGGG#########################################",
    "#############GGGGGG#########################################",
    "#############GGGGGG#########################################",
    "############################################################",
    "######............................................##########",
    "##########..##########a#########################..##########",
    "##########..##########a#########################..##########",
    "##########..##########a#########################..##########",
    "##########..##########a###PPPPPPPPPPPPPPP#######..##########",
    "##########..##########a###PPPPPPPPPPPPPPP#######..##########",
    "....######..##########a###PPPPPPPPPPPPPPP#######..##########",
    "....######..##########a###.PPPPPPPPPPPPPP#######..##########",
    "....######..##########a##.PPPPPPPPPPPPPPP#######..##########",
    "....######..##S#######a#.#PPPPPPPPPPPPPPP###S###..##########",
    "..........................PPPPPPPPPPPPPPP...................",
    "..........................PPPPPPPPPPPPPPP...................",
    "....######..####S####.####PPPPPPPPPPPPPPP#####S#..##########",
    "....######..########.#####PPPPPPPPPPPPPPP#######..##########",
    "....######..#######.######PPPPPPPPPPPPPPP#######..##########",
    "....######..######.#######PPPPPPPPPPPPPPP#######..##########",
    "##########..#####.########PPPPPPPPPPPPPPP#######..S#########",
    "##########..####.#########PPPPPPPPPPPPPPPaaaaaaa..##########",
    "#########S..###.##########PPPPPPPPPPPPPPP#######..##########",
    "##########..##.#################################..##########",
    "##########..#.##################################..##########",
    "##########...###################################..##########",
    "##########..####################################..##########",
    "##########..####################################..##########",
    "######............................................##########",
    "######............................................##########",
    "#####################################################GGGGGG#",
    "#####################################################GGGGGG#",
    "#####################################################GGGGGG#",
    "#####################################################GGGGGG#",
    "#####################################################GGGGGG#",
    "############################################################"
  ],

  /* 6 shops, each tile (x,y) is the 'S' character at that place in rows.
   * Each shop touches an open tile so rioters can reach and break it. */
  shops: [
    { id: 1, name: "Cafe Nord",    x: 14, y: 17 },
    { id: 2, name: "Boulangerie",  x: 16, y: 20 },
    { id: 3, name: "Tabac Est",    x: 44, y: 17 },
    { id: 4, name: "Epicerie",     x: 46, y: 20 },
    { id: 5, name: "Fleuriste",    x: 50, y: 24 },
    { id: 6, name: "Bar Sud",      x: 9,  y: 26 }
  ],

  /* Crowd enters from the west edge staging area (all road tiles). */
  crowdSpawn: { x: 0, y: 13, w: 4, h: 10 },

  /* Middle of the big plaza square. */
  plazaCenter: { x: 33, y: 19 }
};

/* Allow the map to be loaded by node for tests (no effect in the browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = MAP;
}