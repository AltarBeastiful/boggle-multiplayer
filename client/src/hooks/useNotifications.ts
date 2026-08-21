import { useCallback, useEffect, useState } from 'react';

import {
  askForNotifications,
  notificationPermission,
  notificationsOn,
  notificationsSupported,
  setNotificationsOn,
} from '../lib/notify';

function read() {
  return { permission: notificationPermission(), on: notificationsOn() };
}

export interface NotificationSwitch {
  /** False on the browsers that have no Notification at all; hide the bell. */
  supported: boolean;
  /** Refused for good. The browser will not ask again, and neither can we. */
  blocked: boolean;
  on: boolean;
  toggle(): void;
}

/**
 * The bell's state, and the one place the permission is ever asked for.
 *
 * `Notification.permission` is the source of truth; the Permissions API is
 * only listened to, because a player who revokes the permission in the
 * browser's own site settings never touches our button and the bell would
 * otherwise go on claiming to be lit.
 */
export function useNotifications(): NotificationSwitch {
  const [state, setState] = useState(read);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let watched: PermissionStatus | undefined;
    const follow = () => setState(read());
    void navigator.permissions
      .query({ name: 'notifications' })
      .then((status) => {
        watched = status;
        status.addEventListener('change', follow);
      })
      .catch(() => {});
    return () => watched?.removeEventListener('change', follow);
  }, []);

  const toggle = useCallback(() => {
    if (notificationsOn()) {
      setNotificationsOn(false);
      setState(read());
      return;
    }
    // Already granted once: turning it back on is ours to do, not the browser's.
    if (notificationPermission() === 'granted') {
      setNotificationsOn(true);
      setState(read());
      return;
    }
    void askForNotifications().then(() => setState(read()));
  }, []);

  return {
    supported: notificationsSupported(),
    blocked: state.permission === 'denied',
    on: state.on,
    toggle,
  };
}
