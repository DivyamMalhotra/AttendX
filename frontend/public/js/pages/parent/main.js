import { startApp } from '../../services/app.js';
import { parentApi } from '../../api/phase2.js';
import { chooseChild, chosenChild } from '../../services/childScope.js';

/**
 * Parent portal: exactly three things for a verified child: published results, fees and payments (the same pages the
 * student uses, pointed at the parent endpoints). There is no attendance, leave, assignment or any other module here.
 */
const nav = [
  { section: 'My child', items: [{ key: 'children', route: 'children', label: 'My children', icon: 'users' }] },
  { section: 'Academics', items: [{ key: 'results', route: 'results', label: 'Results', icon: 'chart' }] },
  { section: 'Finance', items: [
    { key: 'fees', route: 'fees', label: 'Fees & payments', icon: 'card' },
    { key: 'payments', route: 'payments', label: 'History & receipts', icon: 'receipt' }
  ] }
];

// A page opens only once a child is chosen (a parent with one child is chosen automatically).
async function withChild(loader) {
  let children = [];
  try { children = await parentApi.children(); } catch (e) { /* the page shows its own error */ }
  const chosen = chosenChild();
  const valid = children.find(c => c.studentId === chosen) || (children.length === 1 ? children[0] : null);
  if (valid) { chooseChild(valid.studentId); return loader(); }
  location.hash = '#children';
  return import('./children.js');
}
const page = file => () => withChild(() => import(`../student/${file}`));
const routes = [
  { pattern: 'children', nav: 'children', load: () => import('./children.js') },
  { pattern: 'results', nav: 'results', load: page('results.js') },
  { pattern: 'fees', nav: 'fees', load: page('fees.js') },
  { pattern: 'payments', nav: 'payments', load: page('history.js') }
];

await startApp({ role: 'parent', nav, routes, defaultRoute: 'children' });
