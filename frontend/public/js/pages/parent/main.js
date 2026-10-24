import { startApp } from '../../services/app.js';

const nav = [
  { section: 'Parent portal', items: [
    { key: 'children', route: 'children', label: 'My children', icon: 'users' },
    { key: 'announcements', route: 'announcements', label: 'Announcements', icon: 'bell' }
  ] }
];
const routes = [
  { pattern: 'children', nav: 'children', load: () => import('./children.js') },
  { pattern: 'child/:id', nav: 'children', load: () => import('./child.js') },
  { pattern: 'announcements', nav: 'announcements', load: () => import('../shared/announcements.js') }
];

await startApp({ role: 'parent', nav, routes, defaultRoute: 'children' });
