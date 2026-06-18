import { ClipboardList, Bot, ShieldOff, type LucideIcon } from 'lucide-react';

export type PermissionModeId = 'plan' | 'auto' | 'bypassPermissions';

type PermissionModeConfig = {
  id: PermissionModeId;
  icon: LucideIcon;
  // Trigger pill colors (kept aligned with the legacy selector design).
  pill: string;
  dot: string;
  iconColor: string;
};

// Only the modes that work without an interactive approval UI (the permission
// prompt UI was removed). The displayed badge is always reconciled with the real
// mode echoed back by the SDK — see useChatRealtimeHandlers ('permission_mode').
export const permissionModes: PermissionModeConfig[] = [
  {
    id: 'plan',
    icon: ClipboardList,
    pill: 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10',
    dot: 'bg-primary',
    iconColor: 'text-primary',
  },
  {
    id: 'auto',
    icon: Bot,
    pill: 'border-blue-300/60 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-600/40 dark:bg-blue-900/15 dark:text-blue-300 dark:hover:bg-blue-900/25',
    dot: 'bg-blue-500',
    iconColor: 'text-blue-600',
  },
  {
    id: 'bypassPermissions',
    icon: ShieldOff,
    pill: 'border-orange-300/60 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600/40 dark:bg-orange-900/15 dark:text-orange-300 dark:hover:bg-orange-900/25',
    dot: 'bg-orange-500',
    iconColor: 'text-orange-600',
  },
];

export const PERMISSION_MODE_IDS: PermissionModeId[] = permissionModes.map((m) => m.id);

export const DEFAULT_PERMISSION_MODE: PermissionModeId = 'bypassPermissions';

export function isPermissionModeId(value: unknown): value is PermissionModeId {
  return typeof value === 'string' && PERMISSION_MODE_IDS.includes(value as PermissionModeId);
}
