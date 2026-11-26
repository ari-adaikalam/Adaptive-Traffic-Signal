// Signal controller firmware.
//
// Reads version 3 lines from the host at 9600 baud, passes them through the safety monitor
// (monitor.h), and drives the lamps through six 74HC595 shift registers: 44 lamps, with the
// left arrows, and four outputs spare. The monitor flashes
// red when the host goes quiet or asks for something unsafe, so a bad host cannot light
// conflicting signals.


#include "monitor.h"

const int kDataPin = 2;
const int kClockPin = 3;
const int kLatchPin = 4;
const unsigned long kSecondMs = 1000UL;
const unsigned long kBlinkMs = 500UL;  // flashing lamps are on for half a second, off for half

tc::Monitor monitor;
char display[tc::kMovements + 1] = "FFFFFFFFFFFFSSSS";  // flash until the monitor says otherwise
char line[tc::kMaxLine + 4];
size_t line_length = 0;
bool discarding = false;  // the current line was too long, so skip it up to its newline
unsigned long last_tick = 0;

const int kRegisters = 6;  // chained, so the first byte shifted out ends up in the last register

void write_lamps(uint64_t bits) {
  digitalWrite(kLatchPin, LOW);
  for (int shift = 8 * (kRegisters - 1); shift >= 0; shift -= 8) {
    shiftOut(kDataPin, kClockPin, MSBFIRST, static_cast<uint8_t>(bits >> shift));
  }
  digitalWrite(kLatchPin, HIGH);
}

void setup() {
  pinMode(kDataPin, OUTPUT);
  pinMode(kClockPin, OUTPUT);
  pinMode(kLatchPin, OUTPUT);
  Serial.begin(9600);
  last_tick = millis();
  write_lamps(tc::lamp_bits(display, true));
}

void loop() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n') {
      if (!discarding && line_length < sizeof(line)) {
        line[line_length++] = c;
        monitor.receive(line, line_length);
      }
      line_length = 0;
      discarding = false;
    } else if (!discarding) {
      if (line_length < tc::kMaxLine) {
        line[line_length++] = c;
      } else {
        discarding = true;  // too long to be a line
        line_length = 0;
      }
    }
  }
  const unsigned long now = millis();
  if (now - last_tick >= kSecondMs) {
    last_tick += kSecondMs;
    monitor.tick(display);
  }
  write_lamps(tc::lamp_bits(display, (now / kBlinkMs) % 2 == 0));
}
