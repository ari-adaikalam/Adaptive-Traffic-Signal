// Flash memory access on an AVR board, as plain memory on a computer, so the simulator's demo host can be tested without a board.
#ifndef AVR_PGMSPACE_SHIM_H
#define AVR_PGMSPACE_SHIM_H
#include <stdint.h>
#include <string.h>
#define PROGMEM
#define pgm_read_byte(address) (*(const uint8_t*)(address))
#define strcpy_P(to, from) strcpy((to), (from))
#endif
