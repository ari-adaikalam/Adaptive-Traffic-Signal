// Reference model of the signal controller's own safety monitor. Port of monitor.py, which is
// the specification for the firmware. See that file for the rules.

import { ConflictError, FormatError, MOVEMENTS, decode } from './protocol.js';
import { isInt } from './checks.js';

export const RUN = 'run';
export const FAULT = 'fault';
export const RECOVER = 'recover';

const uniform = (vehicle) => Object.fromEntries(MOVEMENTS.map((m) => [m, m[0] === 'C' ? 'stop' : vehicle]));

export class Monitor {
  constructor({ watchdog_s = 3, recover_messages = 3, recover_all_red_s = 3 } = {}) {
    for (const [name, value, minimum] of [['watchdog_s', watchdog_s, 1], ['recover_messages', recover_messages, 1],
      ['recover_all_red_s', recover_all_red_s, 0]]) {
      if (!isInt(value) || value < minimum) throw new Error(`${name} must be an int of at least ${minimum}`);
    }
    this.watchdog = watchdog_s;
    this.recoverMessages = recover_messages;
    this.recoverAllRed = recover_all_red_s;
    this.second = 0;
    this.state = FAULT;
    this.reason = 'startup';
    this.latest = uniform('red');
    this.lastGood = null;
    this.run = 0;
    this.counted = -10;
    this.tainted = -10;
    this.recoverLeft = 0;
  }

  // Handle one received line. Returns "ok", "format" or "conflict".
  receive(line) {
    let signals;
    try {
      signals = decode(line);
    } catch (error) {
      if (error instanceof FormatError) return 'format';
      if (error instanceof ConflictError) {
        this.trip('conflict');
        return 'conflict';
      }
      throw error;
    }
    this.latest = signals;
    this.lastGood = this.second;
    if (this.tainted === this.second) return 'ok';
    if (this.counted !== this.second) {
      this.run = this.counted === this.second - 1 ? this.run + 1 : 1;
      this.counted = this.second;
    }
    return 'ok';
  }

  trip(reason) {
    if (reason === 'conflict') this.tainted = this.second;
    this.state = FAULT;
    this.reason = reason;
    this.run = 0;
    this.counted = -10;
  }

  // Close the current second and return what the lamps show for it.
  tick() {
    if (this.counted !== this.second) this.run = 0;
    const silent = this.lastGood === null || this.second - this.lastGood >= this.watchdog;
    if ((this.state === RUN || this.state === RECOVER) && silent) this.trip('watchdog');
    if (this.state === FAULT && this.run >= this.recoverMessages) {
      if (this.recoverAllRed === 0) {
        this.state = RUN;
      } else {
        this.state = RECOVER;
        this.recoverLeft = this.recoverAllRed;
      }
    }
    const shown = this.state;
    let signals;
    if (shown === RUN) {
      signals = { ...this.latest };
    } else if (shown === RECOVER) {
      signals = uniform('red');
      this.recoverLeft -= 1;
      if (this.recoverLeft === 0) this.state = RUN;
    } else {
      signals = uniform('flash');
    }
    const output = { second: this.second, state: shown, reason: shown !== RUN ? this.reason : null, signals };
    this.second += 1;
    return output;
  }
}
