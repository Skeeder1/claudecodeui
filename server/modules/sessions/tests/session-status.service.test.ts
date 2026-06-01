import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveSessionStatus } from '@/modules/sessions/services/session-status.service.js';

const nowIso = () => new Date().toISOString();
const longAgoIso = () => new Date(Date.now() - 1000 * 60 * 60).toISOString();

test('isRunning short-circuits to running regardless of last event', () => {
  const status = deriveSessionStatus({
    lastEventKind: 'stop',
    lastEventAt: longAgoIso(),
    lastReadAt: null,
    updatedAt: longAgoIso(),
    isRunning: true,
  });
  assert.equal(status, 'running');
});

test('error event maps to error bucket', () => {
  const status = deriveSessionStatus({
    lastEventKind: 'error',
    lastEventAt: nowIso(),
    lastReadAt: null,
    updatedAt: nowIso(),
  });
  assert.equal(status, 'error');
});

test('action_required maps to needs_attention bucket', () => {
  const status = deriveSessionStatus({
    lastEventKind: 'action_required',
    lastEventAt: nowIso(),
    lastReadAt: null,
    updatedAt: nowIso(),
  });
  assert.equal(status, 'needs_attention');
});

test('stop with no last_read_at maps to done_unread', () => {
  const status = deriveSessionStatus({
    lastEventKind: 'stop',
    lastEventAt: nowIso(),
    lastReadAt: null,
    updatedAt: nowIso(),
  });
  assert.equal(status, 'done_unread');
});

test('stop with last_read_at after event maps to done_read', () => {
  const eventAt = new Date(Date.now() - 5000).toISOString();
  const readAt = new Date().toISOString();
  const status = deriveSessionStatus({
    lastEventKind: 'stop',
    lastEventAt: eventAt,
    lastReadAt: readAt,
    updatedAt: eventAt,
  });
  assert.equal(status, 'done_read');
});

test('stop with later event re-fires done_unread even if previously read', () => {
  const readAt = new Date(Date.now() - 10_000).toISOString();
  const eventAt = new Date().toISOString();
  const status = deriveSessionStatus({
    lastEventKind: 'stop',
    lastEventAt: eventAt,
    lastReadAt: readAt,
    updatedAt: eventAt,
  });
  assert.equal(status, 'done_unread');
});

test('recent updated_at without event falls back to running heuristic', () => {
  const status = deriveSessionStatus({
    lastEventKind: null,
    lastEventAt: null,
    lastReadAt: null,
    updatedAt: nowIso(),
  });
  assert.equal(status, 'running');
});

test('old updated_at without event falls back to idle', () => {
  const status = deriveSessionStatus({
    lastEventKind: null,
    lastEventAt: null,
    lastReadAt: null,
    updatedAt: longAgoIso(),
  });
  assert.equal(status, 'idle');
});
