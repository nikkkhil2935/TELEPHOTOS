/**
 * Pure, unit-testable Telegram MTProto authentication and peer helpers.
 */

export function normalizeChannelId(channelId: string): string {
  return String(channelId || '')
    .trim()
    .replace(/^-100/, '')
    .replace(/^\+/, '');
}

/**
 * Converts a raw Telegram QR login token into the official RFC 4648 base64url
 * URI (`tg://login?token=...`) without relying on Node-only encodings.
 */
export function buildTelegramQrUrl(token: Uint8Array | ArrayBuffer): string {
  const bytes = token instanceof Uint8Array ? token : new Uint8Array(token);
  let base64: string;
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  } else {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `tg://login?token=${base64Url}`;
}

export function validateTelegramCredentials(
  apiIdRaw: string,
  apiHashRaw: string
): { valid: true; apiId: number; apiHash: string } | { valid: false; error: string } {
  const apiId = Number.parseInt(apiIdRaw.trim(), 10);
  const apiHash = apiHashRaw.trim();
  if (!Number.isInteger(apiId) || apiId <= 0) {
    return {
      valid: false,
      error: 'Enter a valid numeric Telegram API ID from my.telegram.org.',
    };
  }
  if (!/^[a-fA-F0-9]{32}$/.test(apiHash)) {
    return {
      valid: false,
      error: 'Enter a valid 32-character hexadecimal Telegram API Hash from my.telegram.org.',
    };
  }
  return { valid: true, apiId, apiHash };
}

export function validateInternationalPhone(
  phoneRaw: string
): { valid: true; phone: string } | { valid: false; error: string } {
  const cleaned = phoneRaw.replace(/[\s\-()]/g, '').trim();
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Enter your phone number in international format with country code (e.g. +14155550199 or +919820012345).',
    };
  }
  return { valid: true, phone: cleaned };
}

export interface FormattedTelegramError {
  code: string;
  message: string;
  requires2fa: boolean;
}

/**
 * Translates raw GramJS / Telegram MTProto RPC errors into actionable user-facing copy.
 */
export function formatTelegramAuthError(err: unknown): FormattedTelegramError {
  const rawObj = err as { errorMessage?: string; message?: string; seconds?: number } | null;
  const raw = String(rawObj?.errorMessage || rawObj?.message || err || 'Unknown Telegram error');
  const upper = raw.toUpperCase();

  if (upper.includes('SESSION_PASSWORD_NEEDED') || upper === '2FA_REQUIRED') {
    return {
      code: 'SESSION_PASSWORD_NEEDED',
      message: 'Your Telegram account has Two-Step Verification enabled. Enter your 2FA Cloud Password to continue.',
      requires2fa: true,
    };
  }
  if (upper.includes('PASSWORD_HASH_INVALID')) {
    return {
      code: 'PASSWORD_HASH_INVALID',
      message: 'Incorrect 2FA Cloud Password. Please verify and try again.',
      requires2fa: true,
    };
  }
  if (upper.includes('PHONE_CODE_INVALID')) {
    return {
      code: 'PHONE_CODE_INVALID',
      message: 'Invalid verification code. Check the latest login code sent to your Telegram app or SMS.',
      requires2fa: false,
    };
  }
  if (upper.includes('PHONE_CODE_EXPIRED')) {
    return {
      code: 'PHONE_CODE_EXPIRED',
      message: 'This verification code has expired. Go back and request a fresh code.',
      requires2fa: false,
    };
  }
  if (upper.includes('PHONE_NUMBER_INVALID')) {
    return {
      code: 'PHONE_NUMBER_INVALID',
      message: 'Telegram rejected this phone number. Include the + country code without extra punctuation.',
      requires2fa: false,
    };
  }
  if (upper.includes('PHONE_NUMBER_BANNED')) {
    return {
      code: 'PHONE_NUMBER_BANNED',
      message: 'This phone number is restricted by Telegram.',
      requires2fa: false,
    };
  }
  if (upper.includes('API_ID_INVALID') || upper.includes('API_ID_PUBLISHED_FLOOD')) {
    return {
      code: 'API_ID_INVALID',
      message: 'Invalid or rate-limited Telegram API ID / API Hash. Create your own keys at my.telegram.org/apps.',
      requires2fa: false,
    };
  }
  const floodMatch = upper.match(/FLOOD_WAIT[_\s]*(\d+)/);
  if (floodMatch) {
    const secs = Number(floodMatch[1] || rawObj?.seconds || 60);
    return {
      code: 'FLOOD_WAIT',
      message: `Telegram rate-limited requests temporarily. Please wait ${secs} seconds and try again.`,
      requires2fa: false,
    };
  }
  if (upper.includes('AUTH_TOKEN_EXPIRED')) {
    return {
      code: 'AUTH_TOKEN_EXPIRED',
      message: 'QR login token expired. Click Refresh QR Code to generate a new one.',
      requires2fa: false,
    };
  }
  if (upper.includes('WEBSOCKET') || upper.includes('CONNECTION') || upper.includes('TIMEOUT')) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Could not reach Telegram WebSocket datacenters (wss://*.web.telegram.org). Check your network or firewall.',
      requires2fa: false,
    };
  }

  return {
    code: 'TELEGRAM_RPC_ERROR',
    message: raw,
    requires2fa: false,
  };
}
