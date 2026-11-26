import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLiveWeather, weatherFromCode } from '../src/scene/weather.js';

test('the WMO codes fold into the five kinds of weather in the scene', () => {
  const expect = { 0: 'clear', 1: 'clear', 2: 'partly', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'rain', 55: 'rain', 61: 'rain', 65: 'rain', 67: 'rain', 80: 'rain', 82: 'rain', 95: 'rain', 99: 'rain', 71: 'overcast', 75: 'overcast', 86: 'overcast' };
  for (const [code, name] of Object.entries(expect)) assert.equal(weatherFromCode(Number(code)), name, `code ${code}`);
  for (const bad of [4, 44, 50, 70, 100, -1, 2.5, '3', null, undefined, NaN]) assert.throws(() => weatherFromCode(bad), `code ${bad}`);
});

const reply = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('a good reply gives the weather, and the request carries only the coordinates it was given', async () => {
  let asked = '';
  const fake = async (url) => { asked = url; return { ok: true, status: 200, json: async () => ({ current: { weather_code: 63 } }) }; };
  assert.equal(await fetchLiveWeather(20.6, 79, fake), 'rain');
  const url = new URL(asked);
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '20.60');
  assert.equal(url.searchParams.get('longitude'), '79.00');
  assert.equal(url.searchParams.get('current'), 'weather_code');
});

test('a failed, damaged or odd reply rejects, so the scene keeps its daily pick', async () => {
  await assert.rejects(fetchLiveWeather(20.6, 79, reply({}, false, 503)), /503/);
  await assert.rejects(fetchLiveWeather(20.6, 79, reply({ current: {} })), /unknown weather code/);
  await assert.rejects(fetchLiveWeather(20.6, 79, reply(null)), /unknown weather code/);
  await assert.rejects(fetchLiveWeather(20.6, 79, reply({ current: { weather_code: 'rain' } })), /unknown weather code/);
  await assert.rejects(fetchLiveWeather(20.6, 79, async () => { throw new TypeError('network down'); }), /network down/);
  await assert.rejects(fetchLiveWeather(NaN, 79, reply({})), /bad coordinates/);
  await assert.rejects(fetchLiveWeather(91, 79, reply({})), /bad coordinates/);
  await assert.rejects(fetchLiveWeather(20, 181, reply({})), /bad coordinates/);
});
