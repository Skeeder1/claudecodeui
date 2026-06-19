import { useCallback, useState } from 'react';

import type { PendingPermissionRequest, PermissionDecision } from '../types/types';

/**
 * Holds the tool-use permission requests currently awaiting a user decision and
 * exposes helpers to add/remove them and to send the decision back over the
 * WebSocket.
 *
 * The requests wait indefinitely server-side (no auto-deny) and are re-emitted by
 * the backend on reconnect (`check-session-status`), so this state is purely the
 * in-memory mirror of what the server is still blocking on — no local persistence
 * needed.
 */
export function useChatPermissions(sendMessage: (message: unknown) => void) {
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);

  const addPermissionRequest = useCallback((request: PendingPermissionRequest) => {
    if (!request || typeof request.requestId !== 'string') return;
    setPendingPermissions((previous) =>
      previous.some((entry) => entry.requestId === request.requestId)
        ? previous
        : [...previous, request],
    );
  }, []);

  const removePermissionRequest = useCallback((requestId: string) => {
    if (typeof requestId !== 'string') return;
    setPendingPermissions((previous) => previous.filter((entry) => entry.requestId !== requestId));
  }, []);

  const clearPermissionRequests = useCallback(() => {
    setPendingPermissions((previous) => (previous.length === 0 ? previous : []));
  }, []);

  const respondToPermission = useCallback(
    (request: PendingPermissionRequest, decision: PermissionDecision) => {
      sendMessage({
        type: 'permission-response',
        requestId: request.requestId,
        decision,
        sessionId: request.sessionId ?? null,
      });
      removePermissionRequest(request.requestId);
    },
    [sendMessage, removePermissionRequest],
  );

  return {
    pendingPermissions,
    addPermissionRequest,
    removePermissionRequest,
    clearPermissionRequests,
    respondToPermission,
  };
}
