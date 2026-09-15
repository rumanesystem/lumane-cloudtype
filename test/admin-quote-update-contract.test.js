'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('admin quote update only accepts the operational fields and confirms the matched record', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.patch('/api/quotes/:id'"), server.indexOf('// ── 삭제됨 (보안): /api/quote POST'));
  assert.match(route, /updates\.status\s*=\s*body\.status\.slice\(0, 50\)/);
  assert.match(route, /updates\.manager\s*=\s*body\.manager\.slice\(0, 100\)/);
  assert.match(route, /updates\.memo\s*=\s*body\.memo\.slice\(0, 2000\)/);
  assert.match(route, /\.eq\('id', id\)[\s\S]*\.select\(\)[\s\S]*\.single\(\)/);
  assert.match(route, /PGRST116[\s\S]*res\.status\(404\)/);
});
