# Timing assumptions and sources

Checked on 2026-11-19. "Read" means the passage was read in the document itself. "Cited" means another document reports it. Nothing here comes from memory.

Documents read:

- **SA TS001**: South Australia Department for Infrastructure and Transport, Traffic Signal Standard TS001 Signal Timings, version 1.3, 2023. Its technical references are Austroads Guide to Traffic Management (AGTM) Part 9 tables and appendices.
- **Qld RPDM 18**: Queensland Road Planning and Design Manual, Chapter 18 Traffic Signals, July 2002.
- **ATRF 2018**: Australasian Transport Research Forum 2018, paper on walking speeds at signalised crossings in Melbourne.
- **Vic FAQ**: Transport Victoria, traffic signal design and operation FAQs.
- **IRC:93**: Indian Roads Congress, Guidelines on Design and Installation of Road Traffic Signals, 1985 edition.

## Values and where they come from

| Parameter | Value used | Source | Status |
|---|---|---|---|
| Yellow | 4 s for a 60 km/h road | SA TS001 Table 1: 40 km/h 3.0 s, 50 and 60 km/h 4.0 s, 70 km/h 4.5 s, 80 km/h 5.0 s, 90 km/h 5.5 s, 100 km/h 6.0 s. It says the values come from AGTM Part 9 Table G2, adjusted for South Australia. Qld RPDM 18.16.2.1 agrees: 4 s up to 60 km/h, 5 s over 60 up to 80 km/h | Read in two documents |
| All-red | 2 s | SA TS001 Table 3, speed under 80 km/h: critical clearance distance 14 to under 21 m gives 1.5 s, 21 to under 28 m gives 2.0 s, 28 to under 35 m gives 2.5 s. Derived from AGTM Part 9 Appendix G.4.6, and "in some cases longer". Qld RPDM 18.16.2.3: minimum 1.0 s, start value d/14 s up to 60 km/h | Read. This layout has a critical clearance distance of about 24 m, so SA gives 2.0 s and Qld gives 1.7 s. Recheck when the simulator geometry is final. |
| Minimum green | 5 s | SA TS001 section 5: basic minimum green of 5 s, based on Austroads recommendations adjusted for South Australia, and 10 s for a stretch phase. Qld RPDM 18.16.3.2: typical setting 5 s | Read in two documents |
| Walking speed | 1.2 m/s | SA TS001 6.1: "Austroads literature indicates that the 15th percentile walking speed is approximately 1.2 m/s", used for clearance. 1.0 m/s where a longer clearance is needed (6.2). ATRF 2018: usual Australian speed is 1.2 m/s, citing Austroads 2016, TMR 2014, Department of Transport 2011, RMS 2010. Qld 18.16.4.3 agrees | Read in three documents |
| Pedestrian walk time | 6 s minimum | SA TS001 section 6: basic minimum walk time 5 s. Qld RPDM 18.16.4.2: W/2.4 s with a 6 s minimum, plus 2 s per rank of waiting pedestrians, where W is the crossing width in metres | Read. The two disagree by 1 s, so the safer 6 s is used. |
| Pedestrian clearance | total W/1.2 s, rounded up | SA TS001 6.1: tpc = Lc / vw, where Lc is the kerb to kerb distance through the centre of the marked crossing. tpc = tc1 + tc2. tc2 = shortest intergreen minus all-red, so it runs through the vehicle yellow. tc1 = tpc minus tc2 and runs in green. Both show the same flashing red man. Qld RPDM 18.16.4.3 gives the same split | Read in two documents |
| Pedestrian display order | walk, flashing red, solid red | Vic FAQ: "walk time (green walk display), a clearance time (flashing red display) and a solid red display". Slow pedestrians are advised to start only at the beginning of the walk display | Read. No numbers on that page. |
| Solid red man before a conflicting green | all-red time (2 s) | The SA and Qld rules above end the flashing at the end of the yellow, so the solid red equals the all-red. ATRF 2018, citing VicRoads 2015, reports Victoria adds at least 3 s of solid red don't walk and uses 1.5 m/s for clearance | The Victorian rule is cited, not read at source, and is not adopted. |
| Delay from button to walk | 5 to 10 s | Qld RPDM 18.16.4.1 | Read |
| India | pedestrian green is W/1.2 s plus 7 s for reaction | IRC:93-1985 section 22.1, with a worked example of a 12 m crossing giving 10 s plus 7 s | Read in an archived copy of the 1985 edition. A newer edition may differ. The amber time is not stated in the passages read. |
