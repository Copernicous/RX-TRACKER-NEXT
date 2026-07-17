'use strict';
const path = require('path');
const { Service } = require('node-windows');
const action = String(process.argv[2] || '').toLowerCase();
const root = path.resolve(__dirname, '..');
const service = new Service({
  name: '0-RX-TRACKER',
  description: 'RX Tracker project-owned web service',
  script: path.join(root, 'app.js'),
  workingDirectory: root,
  env: [{ name: 'NODE_ENV', value: 'production' }],
  stopparentfirst: true,
  stoptimeout: 30,
  wait: 2,
  grow: 0.5,
  maxRestarts: 5
});
function fail(error) { console.error(error?.message || error); process.exitCode = 1; }
if (action === 'install') {
  service.on('install', () => { console.log('Installed 0-RX-TRACKER.'); process.exit(0); });
  service.on('alreadyinstalled', () => { console.log('0-RX-TRACKER is already installed.'); process.exit(0); });
  service.on('error', fail); service.install();
} else if (action === 'uninstall') {
  service.on('uninstall', () => { console.log('Removed 0-RX-TRACKER.'); process.exit(0); });
  service.on('alreadyuninstalled', () => { console.log('0-RX-TRACKER is not installed.'); process.exit(0); });
  service.on('error', fail); service.uninstall();
} else fail('Usage: node scripts/windows-service.js install|uninstall');
