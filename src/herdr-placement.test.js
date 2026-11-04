import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaneCloseCommand, buildPaneCreationCommand } from './herdr.js';

test('dev server defaults to a separately named tab', () => {
  assert.deepEqual(buildPaneCreationCommand('/work/app', {}, {}), {
    layout: 'tab',
    args: ['tab', 'create', '--cwd', '/work/app', '--label', 'devloop', '--no-focus'],
  });
});

test('stopping closes the created tab or only the split pane', () => {
  assert.deepEqual(buildPaneCloseCommand({ layout: 'tab', tab_id: 'w1:t2', pane_id: 'w1:p4' }), ['tab', 'close', 'w1:t2']);
  assert.deepEqual(buildPaneCloseCommand({ layout: 'split', pane_id: 'w1:p4' }), ['pane', 'close', 'w1:p4']);
  assert.deepEqual(buildPaneCloseCommand({ pane_id: 'w1:p4' }), ['pane', 'close', 'w1:p4']);
});

test('dev server can use a sibling split or a configured tab label', () => {
  assert.deepEqual(buildPaneCreationCommand('/work/app', { layout: 'split' }), {
    layout: 'split',
    args: ['pane', 'split', '--current', '--direction', 'right', '--cwd', '/work/app', '--no-focus'],
  });
  assert.deepEqual(buildPaneCreationCommand('/work/app', { layout: 'tab', tabName: 'api server' }, { HERDR_WORKSPACE_ID: 'w9' }), {
    layout: 'tab',
    args: ['tab', 'create', '--workspace', 'w9', '--cwd', '/work/app', '--label', 'api server', '--no-focus'],
  });
});
