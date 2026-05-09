import cat from './cat.js';
import rabbit from './rabbit.js';
import cogi from './cogi.js';
import capybara from './capybara.js';

const POOLS = { cat, rabbit, cogi, capybara };

export function getLine(animalKey, category) {
  const pool = POOLS[animalKey];
  if (!pool) return null;
  let lines = pool[category];
  if (!lines || !lines.length) lines = pool.idle;
  if (!lines || !lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

export function pick(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getPool(animalKey) {
  return POOLS[animalKey] || null;
}
