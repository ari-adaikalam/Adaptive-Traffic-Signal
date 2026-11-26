// Just enough of the Arduino API to syntax check the sketch on a computer. Not a simulator.
#ifndef ARDUINO_SHIM_H
#define ARDUINO_SHIM_H

#include <stddef.h>
#include <stdint.h>

#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define MSBFIRST 1

void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
void shiftOut(uint8_t data_pin, uint8_t clock_pin, uint8_t bit_order, uint8_t value);
unsigned long millis();

struct SerialPort {
  void begin(unsigned long baud);
  int available();
  int read();
};
extern SerialPort Serial;

#endif
