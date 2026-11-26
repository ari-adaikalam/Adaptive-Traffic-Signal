# Simulator

The simulator runs the real controller (`web/src/signals.js`) against simulated traffic. It compares adaptive control with fixed timing on identical traffic, and it drives the page. It was built because a model on a desk is hard to show and slow to experiment on, and the rules found here went into the firmware. The results are in [results](results.md).

Code is in `web/src/sim/`, and the tests are in `web/test/`. To compare plans, run `node web/scripts/compare.js [preset|all] [seeds] [seconds]`.

## What is modelled

**Traffic**

- **Arrivals.** Poisson arrivals per road, with a class mix (car, truck, bus, bike) and a turning split. They come from seeded streams that ignore the signals, so both plans meet the same vehicles.
- **Movement.** Real scale at 60 km/h. Vehicles follow the one ahead with the intelligent driver model. They stop at yellow only if the stop needs under 3.5 m/s².
- **Lanes.** Kerb, through and right turn. While the bus lane is active, only buses, bikes and left-turning vehicles use the kerb lane.
- **Left turners and the walk.** On the page, a left turner holds at the stop line while the green man shows for the crossing it turns across, and moves up once the flashing red man starts, which is when the left arrow shown for it turns green. It waits short of the crossing if people are still on it. The option is off by default, so the results tables are measured without it. At light and moderate traffic it changes mean vehicle delay by less than 0.3 s.
- **Lane changes.** A vehicle in free flow, more than 45 m from the stop line, moves over when the vehicle ahead is at least 1.5 m/s slower. It needs a gap ahead and behind, and it never enters the active bus lane.
- **Demand.** Presets (light, moderate, uneven, peak, bus hours, the day) and a clock demand that follows the time of the week, with two weekday peaks and a quiet night.

**Detection.** The camera rig counts vehicles within 80 m of the stop line once a second. Each road has two cameras, and the share they pick out in each 20 m comes from their geometry. A long vehicle counts for the lane it takes up. There is no count of left turners, so left turners get a fixed 6 s arrow window. The detector's counts can replace the rig's (see [detector](detector.md)).

**People**

- Each pedestrian walks in along the footpath, presses the button, waits for a walk, crosses 19.2 m at 1.0 to 1.5 m/s, and walks out.
- With the clock demand, 70% press the button and 30% wait for someone else. Someone who has waited past their patience (45 to 140 s) gives up and turns back. About a quarter arrive in groups.
- A turning vehicle gives way to pedestrians on the crossing it turns across. Where a side street meets the road, a vehicle stops 2 m short of the zebra crossing while anyone is on it.

**Emergency vehicles**

- An ambulance, fire engine or police car asks for priority 120 m out. It goes straight on, left or right, and changes lane toward the clearer lane. Vehicles behind it ease off.
- The fixed plan has no priority. The vehicle crosses a red or yellow only when nobody is in its way, nothing crossing its path is in the junction, and nothing that has a light can reach the junction first. If something comes into its way, it brakes again.

**Faults.** Vehicles with a green get their 4 s yellow, then every signal is red. People already crossing keep the flashing man.

## Calibration

A queue of cars discharges at a 2.1 s headway per lane, about 1,700 vehicles an hour. That is the saturation flow in the worked example of Queensland RPDM chapter 18, section 18.16.3.6. The steady discharge time is car 2 s, bike 1 s, bus 3 s and truck 3 s. The controller's clearance times are 1.5 times that, chosen on separate tuning seeds. The simulated junction caps a green at 40 s, while the controller's own limit stays 60 s.

## How it is checked

- **Tests** cover reproducibility, identical arrivals in both modes, that every vehicle is accounted for, no overlaps or reversing, the speed limit, the discharge headway, no red-light runs or conflicts in any preset, the bus lane rule, emergency priority, faults at any moment, pedestrians who never vanish, and a camera that misses 30% of vehicles.
- **A stress campaign** (`node web/tools/stress.mjs`) runs 12 demand cases, both modes, 5 controller settings and 3 seeds for 30 simulated minutes, with emergency vehicles, faults and button presses. Every second it checks for overlaps, red-light runs, conflicting signals, a green going straight to red, and vehicles stuck in the junction. Two full runs, 720 runs in all, found no violation.
- **Up to 40 emergency vehicles at once** never caused a conflicting signal or a crash. Every vehicle crossed. A request older than 60 s crosses on the normal cycle.
