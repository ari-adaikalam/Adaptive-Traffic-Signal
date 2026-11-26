# The scene

The 3D scene runs the real controller and simulator and draws what happens. The page around it is one dock and one panel. Nothing in the scene is drivable. The flat 2D view (`?flat`) is the fallback for a browser without WebGL.

## The models

Everything is built in code from Three.js shapes, with no model files and no downloaded textures. Cars are lookalikes of common real cars.

| File | What it builds |
|---|---|
| `web/src/scene/vehicles.js` | Every road vehicle, from six car styles to a semi, four bus kinds, a scooter and an ambulance |
| `web/src/scene/people.js` | People of three ages, a pram and a cyclist |
| `web/src/scene/trees.js` | Eight kinds of tree |
| `web/src/scene/water.js` | The fountain and the pond |
| `web/src/scene/main.js` | The junction, the buildings, the park and the people in it |

The roads have a bus lane in each direction, eight in all: the kerb lane that traffic comes in on, and the kerb lane it leaves by.

A vehicle is merged into one glossy mesh, one matte mesh and a few glowing ones, with colours in the vertices. About 27 make-ups cover every vehicle, so the shapes are shared. A vehicle is fitted to the simulator's box for its class, so what you see is what the simulator moves.

## Sun, light and weather

One sun height drives the sky, the sun and moon, the shadows, the lamps, the windows and the page's own colours.

- **Live** follows the clock. **Dawn, Day, Dusk and Night** hold the light. Gliding to one takes 1.5 s.
- **The sun's place is real.** Its height and bearing come from the NOAA formulas for the visitor's date and clock. The place comes from the browser's time zone, which names a city. The page never asks for the visitor's location.
- **The compass.** East is +x, south is +z, and the north road runs along -z. The sun rises in the east. At noon it is south of overhead in the northern hemisphere and north of it in the southern. `web/test/sun.test.js` checks the equinox, the solstices and both hemispheres.
- **Weather** is the real weather near that city, from Open-Meteo. It is asked for on load and every 20 minutes. If it fails, a daily pick stands in.
- **Night.** The street light is a white wash along each road. Lamps and windows come on 5 degrees of sun height after the daylight goes. The pavement is one colour at night, and a stencil stops the road glow showing through it.

## The view

The view moves like a map.

| Input | Does |
|---|---|
| One finger, or a left drag | Moves the ground under it |
| Two fingers | A pinch zooms, a twist turns, a swipe down tilts toward the horizon, a drag sideways moves |
| A right drag, or Shift, Ctrl or Cmd with a left drag | Turns and tilts |
| The wheel, or a trackpad pinch | Zooms toward the pointer |
| A double click or double tap | Zooms in (with Shift, out) |
| Arrows, Shift with arrows, plus and minus | Move, turn and tilt, zoom |

The viewpoint keeps 2.2 m clear of everything solid. The 18 "Go to" views are fitted to the screen, so they sit whole and centred on a phone and on a wide window. The two-finger arithmetic is in `web/src/scene/touch-gestures.js`.

## The panels

One panel opens at a time. It is one fixed size and never scrolls, on a phone, an iPad or a laptop, in portrait or landscape. A line that fills in later starts with default words and an exact height, so nothing moves when it arrives. Each table's rows take the height the panel has. This was checked at 11 screen sizes by filling every such line with its longest text and comparing every element's place before and after.
