// Host test harness for monitor.h. Reads commands on stdin and prints results on stdout.
//   NEW <watchdog> <recover messages> <recover all red>   start a new monitor
//   LINE <hex of the bytes, or - for none>                 monitor.receive()
//   TICK                                                   monitor.tick()
//   PARSE <hex>                                            parse_line()
//   LAMPS <16 characters> <0|1>                            lamp_bits()
#include <cstdio>
#include <iostream>
#include <string>

#include "../traffic_firmware/monitor.h"

static std::string unhex(const std::string& text) {
  std::string out;
  if (text == "-") return out;
  for (size_t i = 0; i + 1 < text.size(); i += 2) {
    out.push_back(static_cast<char>(std::stoi(text.substr(i, 2), nullptr, 16)));
  }
  return out;
}

int main() {
  tc::Monitor* monitor = new tc::Monitor();
  std::string command;
  while (std::cin >> command) {
    if (command == "NEW") {
      int watchdog = 0, messages = 0, red = 0;
      std::cin >> watchdog >> messages >> red;
      delete monitor;
      monitor = new tc::Monitor(watchdog, messages, red);
    } else if (command == "LINE") {
      std::string hex;
      std::cin >> hex;
      const std::string bytes = unhex(hex);
      std::printf("L %d\n", static_cast<int>(monitor->receive(bytes.data(), bytes.size())));
    } else if (command == "TICK") {
      char display[tc::kMovements + 1];
      const tc::State state = monitor->tick(display);
      std::printf("T %d %s\n", static_cast<int>(state), display);
    } else if (command == "PARSE") {
      std::string hex;
      std::cin >> hex;
      const std::string bytes = unhex(hex);
      char payload[tc::kMovements + 1] = "-";
      const tc::Result result = tc::parse_line(bytes.data(), bytes.size(), payload);
      std::printf("P %d %s\n", static_cast<int>(result), result == tc::kOk ? payload : "-");
    } else if (command == "LAMPS") {
      std::string payload;
      int blink = 0;
      std::cin >> payload >> blink;
      std::printf("M %012llx\n", static_cast<unsigned long long>(tc::lamp_bits(payload.c_str(), blink != 0)));
    }
  }
  delete monitor;
  return 0;
}
