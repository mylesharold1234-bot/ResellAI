import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateProfit } from './profit';
test('accounts for all expenses and fee', () => { const r = calculateProfit(100, 40, 8, 10, 2); assert.equal(r.profit, 40); assert.equal(r.proceeds, 80); assert.equal(r.roi, 80); });
test('zero cost has no defined ROI', () => assert.equal(calculateProfit(100, 0, 0, 0, 0).roi, null));
test('rejects invalid inputs', () => { assert.throws(() => calculateProfit(100, -1, 0, 10, 0)); assert.throws(() => calculateProfit(100, 1, 0, 101, 0)); });
