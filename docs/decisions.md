# Decisions

The main choices, each with its reason and what was rejected. The numbers are in [results](results.md) and the rules are in [controller](controller.md).

## The controller

- **Opposing roads run together.** They do not conflict, so this serves twice the traffic of one road at a time. The cycle is fixed, so no road can starve. A split-phasing mode would double every test.
- **Conflicts are a whitelist.** A movement pair runs together only if a list says so. A mistake in the list can only slow the junction. The same rule is checked in the engine, the fuzz test, the serial parser and the firmware monitor.
- **Green time comes from the vehicles waiting.** It is `ceil(clearance time / lanes)`, kept between 5 and 60 s, so a bad count cannot starve a road. In the simulator the clearance times are 1.5 times the steady discharge time (car 3, bike 2, bus 5, truck 5 s). The plain times beat the tuned fixed plan at moderate traffic, but lost badly at peak (196 s against 105 s).
- **Missing data never shortens a green.** A count that is late, absent or impossible is unknown, and an unknown road takes the default green. Counts are the median of the last 3 reports. If the host goes quiet, the monitor on the microcontroller flashes red.
- **Left turners get a 6 s arrow window.** Pedestrians hold them up, and a camera over a shared lane cannot count them. After a through phase that served pedestrians, the next arrow phase is owed 6 s. A phase that served nobody owes nothing. This beat a left count in 5 of 6 demand cases.
- **Pedestrians run beside the side street.** A latched button starts a walk only at a compatible green, and the flashing clearance is never cut short.
- **Emergency priority comes from a request.** A vehicle asks when it enters a road's geofence (a polygon around its approach lanes, tested with a point-in-polygon check, see [controller](controller.md#geofence)), so priority never depends on the detector. Requests expire after 60 s, so a stuck client cannot hold a road.
- **Bus priority is limited.** An early green or a 5 s extension applies only inside the schedule, never on the same phase twice running, and never ahead of an emergency.
- **Three implementations share one set of test vectors,** so they cannot drift.

## The hardware

- **The project began with the hardware.** A microcontroller (an Arduino), twelve LEDs and a webcam detector were hard to show and slow to try ideas on. The simulator came next, and the timing rules were worked out there.
- **The firmware follows the simulator's controller.** Once the rules settled, the firmware was written to match them, with the same movements, the same conflict list and the same timings.
- **The host decides and the board checks.** The host sends one line of signal states. The monitor on the microcontroller validates every line, so a bad host cannot light two conflicting greens. It flashes red on a damaged line, an unsafe state or 3 s of silence.
- **The lamps sit on shift registers.** 44 lamps need more outputs than a small board has pins. Six 74HC595 chips are driven from three pins (data, clock, latch).
- **The hardware is not tied to an Arduino.** The monitor is plain C++ with no Arduino dependency, so any microcontroller that reads serial and drives three pins can run it. The sketch targets an Arduino Uno because that is what we started with. It runs on a computer against the same test vectors as the Python and JavaScript controllers. The sketch around it is thin. The circuit is drawn in [circuit.svg](diagrams/circuit.svg).

## The comparison

- **Both plans meet the same traffic.** Arrivals come from seeded streams that ignore the signals.
- **The baseline is one fixed plan for the whole day,** a 40 s green tuned once on separate seeds. A plan tuned to each demand is shown as the hardest case, because a real junction cannot have one. Adaptive is never changed to make it win.
- **Ties are reported.** At the rushes a fixed 40 to 50 s green is about the best any single plan can do. The case for adaptive is that a plan right at 7:30 is wrong at noon.
- **The simulated junction caps a green at 40 s.** That took 2 to 3 s off the rush and changed nothing at midday.

Tried and dropped:

| Method | Result |
|---|---|
| Add the arrivals expected during the green to the queue | Delay rose from 61 s to 82 s and more |
| Extend a green while vehicles wait | Far worse: one road holds the green and starves the rest |
| End a green when its queue clears | No change, because pedestrians already hold most greens |
| Count the queue beyond the camera zone | About 4% gain, even with a perfect count |
| Hold the end of a green for turners | Helps at peak, but pedestrians wait 7 s longer. Off by default |

## The cameras

- **Cameras look across the road.** A camera looking along it loses a car behind a truck from any height, and never passed about 75% of vehicles. Two cameras on building faces, about 10 m up with a 130 degree lens, see 94% or more of every 20 m.
- **The zone is 80 m.** At 60 m or less the queue is longer than the zone, and the controller loses (75 s against 62 s at the morning rush). At 80 m it ties. Beyond 100 m nothing is gained.
- **The cheapest mount that works.** A building face, then a lamp pole, then a new 15 m pole. Two building cameras per road cost about US$61,000 a junction in planning prices.

## The detector

- **Training data comes from the scene.** The simulation knows every vehicle, so the labels are exact. A real photo set would not transfer to the low-poly render.
- **It runs in the browser, and only when asked.** The pictures never leave the page, and nothing downloads (22 MB) until the switch is on. It is off at 4 and 12 times speed.
- **A camera owns a stretch of road.** A vehicle in the overlap is counted by the one camera that owns the place it stands.
- **The model is the smallest that meets the targets.** A larger network was not trained.
- **Targets came first.** "95% exact counts" was rejected, because with eight vehicles in view it needs 99.4% per vehicle. See [detector](detector.md).
- **Delay is measured with the detector in the loop.** The run is stepped by hand, so an hour of traffic does not take an hour. The page's clock is frozen, so a seed gives the same traffic every time.

## The page

- **One panel, one size.** It never scrolls, and nothing moves when text arrives.
- **The view moves like a map.** The scene is a city, and Google Maps and Mapbox set the habit. Object viewers such as Sketchfab use the opposite mapping.
- **Everything is built in code.** There are no model files, so nothing to license or download.
- **Static hosting.** Three.js is pinned by version and hash. The code is cached for an hour and the model for a day, so a returning visitor does not check 60 files again. The page itself is always checked, so a new version is picked up at once. The only other request is the weather, for a city's coordinates.
