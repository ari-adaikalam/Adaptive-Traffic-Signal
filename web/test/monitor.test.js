import test from 'node:test';
import assert from 'node:assert/strict';
import { Monitor } from '../src/monitor.js';
import { MOVEMENTS } from '../src/protocol.js';
import { vector } from './vectors.js';

const CODES = { red: 'R', yellow: 'Y', green: 'G', flash: 'F', stop: 'S', walk: 'W', clear: 'C' };
const code = (signals) => MOVEMENTS.map((m) => CODES[signals[m]]).join('');

test('every hand-worked monitor scenario', () => {
  for (const scenario of vector('monitor_scenarios.json')) {
    const monitor = new Monitor(scenario.settings);
    const outputs = scenario.seconds.map((lines) => {
      for (const line of lines) monitor.receive(line);
      return monitor.tick();
    });
    for (const want of scenario.expect) {
      const got = outputs[want.second];
      assert.deepEqual([got.state, code(got.signals)], [want.state, want.display], `${scenario.name}, second ${want.second}`);
    }
  }
});

test('receive reports what it did with each line, and bad settings are rejected', () => {
  const monitor = new Monitor();
  const good = 'V3 RRRRRRRRRRRRSSSS ' + 'x';
  assert.equal(monitor.receive(good), 'format');
  for (const bad of [{ watchdog_s: 0 }, { watchdog_s: true }, { recover_messages: 0 }, { recover_all_red_s: -1 }, { recover_all_red_s: 1.5 }]) {
    assert.throws(() => new Monitor(bad));
  }
});
