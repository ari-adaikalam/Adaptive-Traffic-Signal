// Safety monitor for the traffic signal controller.
//
// Pure C++11: no Arduino calls, no heap, no String. The rules are specified by
// traffic_controller/monitor.py and protocol.py, and this file is tested against them.
//
// A line is "V3 <16 characters> <2 hex digits>" and a newline. The characters are the
// signals T1..T4, R1..R4, L1..L4 (vehicle and arrow: R Y G F) and C1..C4 (pedestrian: S W C).
// The two hex digits are the CRC-8 (polynomial 0x07) of the 16 characters.

#ifndef TRAFFIC_MONITOR_H
#define TRAFFIC_MONITOR_H

#include <stddef.h>
#include <stdint.h>

namespace tc {

enum Result { kOk = 0, kFormat = 1, kConflict = 2 };
enum State { kRun = 0, kFault = 1, kRecover = 2 };

const int kMovements = 16;  // T1..T4 = 0..3, R1..R4 = 4..7, L1..L4 = 8..11, C1..C4 = 12..15
const int kVehicle = 12;    // signals 0..11 are vehicle and arrow signals, 12..15 are pedestrian signals
const size_t kMaxLine = 24;
const size_t kFrameLength = 22;  // "V3 " + 16 + " " + 2

inline uint8_t crc8(const char* data, size_t length) {
  uint8_t crc = 0;
  for (size_t i = 0; i < length; ++i) {
    crc ^= static_cast<uint8_t>(data[i]);
    for (int bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x80) ? static_cast<uint8_t>((crc << 1) ^ 0x07) : static_cast<uint8_t>(crc << 1);
    }
  }
  return crc;
}

// Pairs of signals that may be active together. Anything not listed conflicts.
struct Pair {
  uint8_t a;
  uint8_t b;
};
const int kAllowedCount = 44;
const Pair kAllowed[kAllowedCount] = {
    {0, 2}, {1, 3},                                          // opposing throughs
    {4, 6}, {5, 7},                                          // opposing right turns
    {12, 13}, {12, 14}, {12, 15}, {13, 14}, {13, 15}, {14, 15},  // crossings with each other
    {12, 1}, {12, 3}, {13, 2}, {13, 0}, {14, 3}, {14, 1}, {15, 0}, {15, 2},  // a crossing with the
                                                             // throughs of the road beside it
    // The left arrows (8..11). A left turn goes with the other left turns, with the through movements of its own approach and the one
    // opposite, and with every right turn except the one from the opposite approach, which leaves into the same lane.
    {8, 9}, {8, 10}, {8, 11}, {9, 10}, {9, 11}, {10, 11},
    {8, 0}, {8, 2}, {9, 1}, {9, 3}, {10, 2}, {10, 0}, {11, 3}, {11, 1},
    {8, 4}, {8, 5}, {8, 7}, {9, 4}, {9, 5}, {9, 6}, {10, 5}, {10, 6}, {10, 7}, {11, 4}, {11, 6}, {11, 7},
};

inline bool compatible(int a, int b) {
  if (a == b) return true;
  for (int i = 0; i < kAllowedCount; ++i) {
    if ((kAllowed[i].a == a && kAllowed[i].b == b) || (kAllowed[i].a == b && kAllowed[i].b == a)) {
      return true;
    }
  }
  return false;
}

inline bool is_lit(int index, char c) {
  return index < kVehicle ? (c == 'G' || c == 'Y') : (c == 'W' || c == 'C');
}

// True when the 16 characters are consistent and no two lit signals conflict.
inline bool safe(const char* payload) {
  bool flashing = false;
  for (int i = 0; i < kVehicle; ++i) flashing = flashing || payload[i] == 'F';
  if (flashing) {
    for (int i = 0; i < kVehicle; ++i) if (payload[i] != 'F') return false;
    for (int i = kVehicle; i < kMovements; ++i) if (payload[i] != 'S') return false;
  }
  for (int a = 0; a < kMovements; ++a) {
    if (!is_lit(a, payload[a])) continue;
    for (int b = a + 1; b < kMovements; ++b) {
      if (is_lit(b, payload[b]) && !compatible(a, b)) return false;
    }
  }
  return true;
}

inline int hex_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

inline bool allowed_char(int index, char c) {
  if (index < kVehicle) return c == 'R' || c == 'Y' || c == 'G' || c == 'F';
  return c == 'S' || c == 'W' || c == 'C';
}

// Parse one received line. On kOk the 16 characters are copied to payload, followed by a NUL.
inline Result parse_line(const char* line, size_t length, char payload[kMovements + 1]) {
  if (length > kMaxLine) return kFormat;
  for (size_t i = 0; i < length; ++i) {
    if (static_cast<uint8_t>(line[i]) > 127) return kFormat;
  }
  size_t n = length;
  if (n >= 2 && line[n - 2] == '\r' && line[n - 1] == '\n') {
    n -= 2;
  } else if (n >= 1 && line[n - 1] == '\n') {
    n -= 1;
  }
  if (n != kFrameLength || line[0] != 'V' || line[1] != '3' || line[2] != ' ' || line[3 + kMovements] != ' ') {
    return kFormat;
  }
  const int high = hex_value(line[4 + kMovements]);
  const int low = hex_value(line[5 + kMovements]);
  if (high < 0 || low < 0) return kFormat;
  for (int i = 0; i < kMovements; ++i) {
    if (!allowed_char(i, line[3 + i])) return kFormat;
  }
  if (static_cast<uint8_t>(high * 16 + low) != crc8(line + 3, kMovements)) return kFormat;
  for (int i = 0; i < kMovements; ++i) payload[i] = line[3 + i];
  payload[kMovements] = '\0';
  return safe(payload) ? kOk : kConflict;
}

// What the lamps do, as a 64 bit map for six shift registers (44 lamps, so 4 bits are unused).
//   Vehicle and arrow signal i (0..11): bit 3i red, 3i+1 yellow, 3i+2 green.
//   Pedestrian signal j (0..3): bit 36+2j red man, 36+2j+1 green man.
// blink_on says whether the flashing lamps are lit during this half second.
inline uint64_t lamp_bits(const char* payload, bool blink_on) {
  uint64_t bits = 0;
  for (int i = 0; i < kVehicle; ++i) {
    switch (payload[i]) {
      case 'R': bits |= 1ULL << (3 * i); break;
      case 'Y': bits |= 1ULL << (3 * i + 1); break;
      case 'G': bits |= 1ULL << (3 * i + 2); break;
      case 'F': if (blink_on) bits |= 1ULL << (3 * i); break;
      default: break;
    }
  }
  for (int j = 0; j < 4; ++j) {
    switch (payload[kVehicle + j]) {
      case 'S': bits |= 1ULL << (36 + 2 * j); break;
      case 'W': bits |= 1ULL << (36 + 2 * j + 1); break;
      case 'C': if (blink_on) bits |= 1ULL << (36 + 2 * j); break;
      default: break;
    }
  }
  return bits;
}

// The monitor sits between the serial line and the lamps and does not trust the host.
//   * A damaged line is ignored and counts as silence.
//   * An intact line with unsafe signals trips a fault at once.
//   * Silence for watchdog seconds trips a fault.
//   * In a fault every vehicle signal flashes red and every pedestrian signal is solid red.
//   * A fault ends after recover_messages consecutive seconds that each carried a good line
//     and no conflicting one. The lamps then stay all red for recover_all_red seconds, and
//     only then follow the host again.
//   * At power up the monitor is in a fault.
// Call receive() for each line that arrived in a second, then tick() once per second.
class Monitor {
 public:
  Monitor(int watchdog = 3, int recover_messages = 3, int recover_all_red = 3)
      : watchdog_(watchdog), recover_messages_(recover_messages), recover_all_red_(recover_all_red) {
    set("RRRRRRRRRRRRSSSS", latest_);
  }

  Result receive(const char* line, size_t length) {
    char payload[kMovements + 1];
    const Result result = parse_line(line, length, payload);
    if (result == kFormat) return kFormat;
    if (result == kConflict) {
      trip(true);
      return kConflict;
    }
    set(payload, latest_);
    has_good_ = true;
    last_good_ = second_;
    if (tainted_ == second_) return kOk;  // a second that carried a conflict never counts
    if (counted_ != second_) {
      run_ = (counted_ == second_ - 1) ? run_ + 1 : 1;
      counted_ = second_;
    }
    return kOk;
  }

  // Closes the second and writes what the lamps show for it, 16 characters and a NUL.
  State tick(char display[kMovements + 1]) {
    if (counted_ != second_) run_ = 0;
    const bool silent = !has_good_ || second_ - last_good_ >= watchdog_;
    if ((state_ == kRun || state_ == kRecover) && silent) trip(false);
    if (state_ == kFault && run_ >= recover_messages_) {
      if (recover_all_red_ == 0) {
        state_ = kRun;
      } else {
        state_ = kRecover;
        recover_left_ = recover_all_red_;
      }
    }
    const State shown = state_;
    if (shown == kRun) {
      set(latest_, display);
    } else if (shown == kRecover) {
      set("RRRRRRRRRRRRSSSS", display);
      if (--recover_left_ == 0) state_ = kRun;
    } else {
      set("FFFFFFFFFFFFSSSS", display);
    }
    ++second_;
    return shown;
  }

 private:
  static void set(const char* from, char to[kMovements + 1]) {
    for (int i = 0; i <= kMovements; ++i) to[i] = from[i];
  }

  void trip(bool conflict) {
    if (conflict) tainted_ = second_;
    state_ = kFault;
    run_ = 0;
    counted_ = -10;
  }

  int watchdog_;
  int recover_messages_;
  int recover_all_red_;
  int32_t second_ = 0;
  State state_ = kFault;
  char latest_[kMovements + 1];
  bool has_good_ = false;
  int32_t last_good_ = 0;
  int run_ = 0;
  int32_t counted_ = -10;
  int32_t tainted_ = -10;
  int recover_left_ = 0;
};

}  // namespace tc

#endif  // TRAFFIC_MONITOR_H
