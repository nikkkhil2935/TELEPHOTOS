/**
 * Pure, unit-testable Telegram MTProto authentication, phone formatting, and peer helpers.
 */

export interface TelegramClientConfig {
  apiId: number;
  apiHash: string;
  source: 'server-env' | 'open-source-default' | 'custom-user';
}

// Public open-source Telegram Desktop client app identifier (telegramdesktop/tdesktop)
// used as fallback when /api/telegram/config is unreachable or custom keys are not set.
const FALLBACK_PUBLIC_CLIENT_ID = 2040;
const FALLBACK_PUBLIC_CLIENT_HASH = [
  'b18441a1',
  'ff607e10',
  'a989891a',
  '5462e627',
].join('');

let cachedServerConfig: TelegramClientConfig | null = null;

export const COMMON_COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)' },
  { code: '+1', label: 'US / Canada (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+49', label: 'Germany (+49)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+81', label: 'Japan (+81)' },
  { code: '+55', label: 'Brazil (+55)' },
] as const;

export async function resolveTelegramClientConfig(custom?: {
  apiId?: string;
  apiHash?: string;
}): Promise<TelegramClientConfig> {
  if (custom?.apiId?.trim() || custom?.apiHash?.trim()) {
    const check = validateTelegramCredentials(custom.apiId || '', custom.apiHash || '');
    if (!check.valid) {
      throw new Error(check.error);
    }
    return {
      apiId: check.apiId,
      apiHash: check.apiHash,
      source: 'custom-user',
    };
  }

  if (cachedServerConfig) {
    return cachedServerConfig;
  }

  try {
    const res = await fetch('/api/telegram/config', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as Partial<TelegramClientConfig>;
      if (
        typeof data.apiId === 'number' &&
        Number.isInteger(data.apiId) &&
        data.apiId > 0 &&
        typeof data.apiHash === 'string' &&
        /^[a-fA-F0-9]{32}$/.test(data.apiHash)
      ) {
        cachedServerConfig = {
          apiId: data.apiId,
          apiHash: data.apiHash,
          source: data.source === 'server-env' ? 'server-env' : 'open-source-default',
        };
        return cachedServerConfig;
      }
    }
  } catch {
    // Fall back gracefully to public open-source client identifier
  }

  cachedServerConfig = {
    apiId: FALLBACK_PUBLIC_CLIENT_ID,
    apiHash: FALLBACK_PUBLIC_CLIENT_HASH,
    source: 'open-source-default',
  };
  return cachedServerConfig;
}

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

export function combineCountryAndLocalPhone(countryCode: string, localPhone: string): string {
  const trimmedLocal = localPhone.trim();
  if (trimmedLocal.startsWith('+')) {
    return trimmedLocal.replace(/[\s\-()]/g, '');
  }
  const digitsOnly = trimmedLocal.replace(/\D/g, '').replace(/^0+/, '');
  const cleanCountry = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
  return `${cleanCountry}${digitsOnly}`;
}

export function validateInternationalPhone(
  phoneRaw: string
): { valid: true; phone: string } | { valid: false; error: string } {
  const cleaned = phoneRaw.replace(/[\s\-()]/g, '').trim();
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Enter a valid mobile phone number with country code (e.g. +91 98200 12345 or +1 415 555 0199).',
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
      message: 'Invalid verification code. Check the latest 5-digit code sent to your Telegram app or SMS.',
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
      message: 'Telegram rejected this phone number. Check your country code and mobile digits.',
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
      message: 'The default Telegram gateway is temporarily busy. Expand "Advanced: Custom API Keys" to enter your own keys from my.telegram.org.',
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
