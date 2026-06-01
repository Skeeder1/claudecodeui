import { BellOff, BellRing, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NotificationPreferencesState } from '../../types/types';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

type NotificationsSettingsTabProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  pushPermission: NotificationPermission | 'unsupported';
  isPushSubscribed: boolean;
  isPushLoading: boolean;
  onEnablePush: () => void;
  onDisablePush: () => void;
};

export default function NotificationsSettingsTab({
  notificationPreferences,
  onNotificationPreferencesChange,
  pushPermission,
  isPushSubscribed,
  isPushLoading,
  onEnablePush,
  onDisablePush,
}: NotificationsSettingsTabProps) {
  const { t } = useTranslation('settings');

  const pushSupported = pushPermission !== 'unsupported';
  const pushDenied = pushPermission === 'denied';

  return (
    <div className="space-y-6 md:space-y-8">
      <SettingsSection title={t('notifications.title')} description={t('notifications.description')}>
        <SettingsCard className="p-4">
          <h4 className="mb-4 font-medium text-foreground">{t('notifications.webPush.title')}</h4>
          {!pushSupported ? (
            <p className="text-sm text-muted-foreground">{t('notifications.webPush.unsupported')}</p>
          ) : pushDenied ? (
            <p className="text-sm text-muted-foreground">{t('notifications.webPush.denied')}</p>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isPushLoading}
                onClick={isPushSubscribed ? onDisablePush : onEnablePush}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isPushSubscribed
                    ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                    : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
                }`}
              >
                {isPushLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isPushSubscribed ? (
                  <BellOff className="w-4 h-4" />
                ) : (
                  <BellRing className="w-4 h-4" />
                )}
                {isPushLoading
                  ? t('notifications.webPush.loading')
                  : isPushSubscribed
                    ? t('notifications.webPush.disable')
                    : t('notifications.webPush.enable')}
              </button>
              {isPushSubscribed && (
                <span className="text-sm text-green-600 dark:text-green-400">
                  {t('notifications.webPush.enabled')}
                </span>
              )}
            </div>
          )}
        </SettingsCard>

        <SettingsCard className="p-4">
          <h4 className="mb-3 font-medium text-foreground">{t('notifications.events.title')}</h4>
          <div className="space-y-3">
            {([
              ['actionRequired', t('notifications.events.actionRequired')] as const,
              ['stop', t('notifications.events.stop')] as const,
              ['error', t('notifications.events.error')] as const,
            ]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={notificationPreferences.events[key]}
                  onChange={(event) =>
                    onNotificationPreferencesChange({
                      ...notificationPreferences,
                      events: { ...notificationPreferences.events, [key]: event.target.checked },
                    })
                  }
                  className="w-4 h-4"
                />
                {label}
              </label>
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
