import { NextResponse } from 'next/server';

/**
 * Telegram MTProto requires a numeric client application identifier (api_id) and its
 * associated public client hash (api_hash) when opening browser WSS sessions.
 *
 * Operators can supply custom values via TELEGRAM_API_ID / TELEGRAM_API_HASH in server
 * environment variables. When unset, this falls back to Telegram Desktop's official
 * open-source public client identifier (published in telegramdesktop/tdesktop) so users
 * can sign in directly with their mobile phone number + OTP or Live QR Code without
 * needing to create developer keys first.
 */
const PUBLIC_OPEN_SOURCE_TG_APP_ID = 2040;
const PUBLIC_OPEN_SOURCE_TG_APP_HASH = [
  'b18441a1',
  'ff607e10',
  'a989891a',
  '5462e627',
].join('');

export async function GET() {
  const rawId =
    process.env.TELEGRAM_API_ID ||
    process.env.NEXT_PUBLIC_TELEGRAM_API_ID ||
    '';
  const rawHash =
    process.env.TELEGRAM_API_HASH ||
    process.env.NEXT_PUBLIC_TELEGRAM_API_HASH ||
    '';

  const parsedId = Number.parseInt(rawId.trim(), 10);
  const trimmedHash = rawHash.trim();
  const hasCustomEnv =
    Number.isInteger(parsedId) &&
    parsedId > 0 &&
    /^[a-fA-F0-9]{32}$/.test(trimmedHash);

  return NextResponse.json(
    {
      apiId: hasCustomEnv ? parsedId : PUBLIC_OPEN_SOURCE_TG_APP_ID,
      apiHash: hasCustomEnv ? trimmedHash : PUBLIC_OPEN_SOURCE_TG_APP_HASH,
      source: hasCustomEnv ? 'server-env' : 'open-source-default',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
