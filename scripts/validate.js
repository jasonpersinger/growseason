const fs = require('node:fs');
const path = require('node:path');

global.window = {};
require(path.join(__dirname, '..', 'data.js'));

const data = window.SEASON_DATA;
const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`Validation failed: ${message}`);
    process.exitCode = 1;
  }
}

function assertUnique(items, label) {
  const seen = new Set();
  for (const item of items) {
    assert(item.id, `${label} item is missing an id`);
    assert(!seen.has(item.id), `${label} has duplicate id "${item.id}"`);
    seen.add(item.id);
  }
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

assertUnique(data.strains, 'strains');
assertUnique(data.tasks, 'tasks');
assertUnique(data.shopping, 'shopping');

assert(isIsoDate(data.season.transplantTarget), 'season.transplantTarget must be YYYY-MM-DD');
assert(isIsoDate(data.season.firstFrostAvg), 'season.firstFrostAvg must be YYYY-MM-DD');

for (const strain of data.strains) {
  for (const field of ['vegStart', 'flowerStart', 'harvestStart', 'harvestEnd']) {
    assert(isIsoDate(strain[field]), `${strain.id}.${field} must be YYYY-MM-DD`);
  }
  if (strain.lightDepMode) {
    for (const field of ['coverStart', 'flowerStart', 'harvestStart', 'harvestEnd']) {
      assert(isIsoDate(strain.lightDepMode[field]), `${strain.id}.lightDepMode.${field} must be YYYY-MM-DD`);
    }
  }
}

for (const task of data.tasks) {
  assert(isIsoDate(task.date), `${task.id}.date must be YYYY-MM-DD`);
  if (task.until) assert(isIsoDate(task.until), `${task.id}.until must be YYYY-MM-DD`);
  if (task.lightDep) {
    assert(isIsoDate(task.lightDep.date), `${task.id}.lightDep.date must be YYYY-MM-DD`);
    assert(task.lightDep.title, `${task.id}.lightDep.title is required`);
  }
}

for (const item of data.shopping) {
  assert(isIsoDate(item.needBy), `${item.id}.needBy must be YYYY-MM-DD`);
}

const categories = new Set(data.shopping.map(item => item.category));
const expectedCategories = ['soil', 'nutrients', 'mobility', 'pests', 'tools', 'lightdep', 'drying', 'privacy'];
for (const category of categories) {
  assert(expectedCategories.includes(category), `unknown shopping category "${category}"`);
}

for (const taskId of ['frost-watch', 'harvest-lb']) {
  const task = data.tasks.find(item => item.id === taskId);
  assert(task && task.lightDep, `${taskId} must define a lightDep task override`);
}

assert(!appJs.includes("item.needBy >= today"), 'Need now filter must include overdue needed shopping items');
assert(appJs.includes("item.needBy <= needBy14"), 'Need now filter must include upcoming needed shopping items');
assert(indexHtml.includes('alpinejs@3.15.12'), 'Alpine should be pinned to an exact reviewed version');
assert(!indexHtml.includes('x-for="s in $store ? null : null"'), 'dead Alpine template must stay removed');

if (!process.exitCode) {
  console.log('Validation passed.');
}
