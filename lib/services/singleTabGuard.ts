const CHANNEL_NAME = 'framely_mtproto_tab_lock';
const LOCK_KEY = 'framely_active_tab_heartbeat';
const HEARTBEAT_MS = 2500;
const STALE_MS = 6500;

export interface SingleTabGuardHandle {
  tabId: string;
  takeOver: () => void;
  dispose: () => void;
}

/**
 * Coordinates single-tab MTProto access using BroadcastChannel + localStorage
 * heartbeat to prevent duplicate MTProto sequence number collisions.
 */
export function startSingleTabGuard(
  onConflictChange: (hasConflict: boolean) => void
): SingleTabGuardHandle {
  const tabId = `tab_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;

  if (typeof window === 'undefined') {
    return { tabId, takeOver: () => {}, dispose: () => {} };
  }

  let disposed = false;
  let bc: BroadcastChannel | null = null;

  const writeHeartbeat = () => {
    try {
      window.localStorage.setItem(
        LOCK_KEY,
        JSON.stringify({ tabId, ts: Date.now() })
      );
    } catch {
      // Ignore storage quota errors in restricted frames
    }
  };

  const checkExistingLock = () => {
    try {
      const raw = window.localStorage.getItem(LOCK_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { tabId: string; ts: number };
      return parsed.tabId !== tabId && Date.now() - parsed.ts < STALE_MS;
    } catch {
      return false;
    }
  };

  if (checkExistingLock()) {
    onConflictChange(true);
  } else {
    writeHeartbeat();
  }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        const msg = event.data as { type: string; tabId: string } | undefined;
        if (!msg || msg.tabId === tabId) return;

        if (msg.type === 'ping') {
          onConflictChange(true);
          bc?.postMessage({ type: 'pong', tabId });
        } else if (msg.type === 'pong' || msg.type === 'takeover') {
          onConflictChange(true);
        }
      };
      bc.postMessage({ type: 'ping', tabId });
    } catch {
      bc = null;
    }
  }

  const onStorage = (e: StorageEvent) => {
    if (disposed || e.key !== LOCK_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as { tabId: string; ts: number };
      if (parsed.tabId !== tabId) {
        onConflictChange(true);
      }
    } catch {
      // Ignore malformed storage values
    }
  };

  window.addEventListener('storage', onStorage);

  const timer = window.setInterval(() => {
    if (!disposed && !checkExistingLock()) {
      writeHeartbeat();
    }
  }, HEARTBEAT_MS);

  const takeOver = () => {
    writeHeartbeat();
    onConflictChange(false);
    bc?.postMessage({ type: 'takeover', tabId });
  };

  const dispose = () => {
    disposed = true;
    window.clearInterval(timer);
    window.removeEventListener('storage', onStorage);
    try {
      const raw = window.localStorage.getItem(LOCK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tabId: string };
        if (parsed.tabId === tabId) {
          window.localStorage.removeItem(LOCK_KEY);
        }
      }
    } catch {
      // Ignore
    }
    bc?.close();
  };

  return { tabId, takeOver, dispose };
}
