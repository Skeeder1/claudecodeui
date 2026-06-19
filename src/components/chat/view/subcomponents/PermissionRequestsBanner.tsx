import { ShieldAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import type { PendingPermissionRequest, PermissionDecision } from '../../types/types';

function formatInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'object') {
    const command = (input as { command?: unknown }).command;
    if (typeof command === 'string') return command;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

type PermissionRequestsBannerProps = {
  requests: PendingPermissionRequest[];
  onRespond: (request: PendingPermissionRequest, decision: PermissionDecision) => void;
};

/**
 * Inline approval banner for Claude tool-use permission requests. Each request
 * waits indefinitely until the user picks Accept / Always allow / Deny. "Always
 * allow" persists a native rule in the project's `.claude/settings.json`.
 */
export default function PermissionRequestsBanner({
  requests,
  onRespond,
}: PermissionRequestsBannerProps) {
  const { t } = useTranslation('chat');

  if (!requests.length) {
    return null;
  }

  return (
    <div className="mx-3 mb-2 space-y-2">
      {requests.map((request) => {
        const detail = formatInput(request.input);
        const title =
          (typeof request.title === 'string' && request.title) ||
          t('permissions.title', {
            tool: request.toolName,
            defaultValue: 'Claude wants to use {{tool}}',
          });

        return (
          <div
            key={request.requestId}
            className="rounded-lg border border-orange-300/60 bg-orange-50 p-3 dark:border-orange-600/40 dark:bg-orange-900/15"
          >
            <div className="flex items-start gap-2">
              <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-200">{title}</p>
                {detail ? (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-orange-100/70 px-2 py-1 text-xs text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
                    {detail}
                  </pre>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRespond(request, 'deny')}
              >
                {t('permissions.deny', { defaultValue: 'Deny' })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRespond(request, 'always')}
              >
                {t('permissions.always', { defaultValue: 'Always allow' })}
              </Button>
              <Button
                size="sm"
                onClick={() => onRespond(request, 'allow')}
              >
                {t('permissions.allow', { defaultValue: 'Accept' })}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
