'use client';

import React from 'react';

interface FramelyLogoProps {
  size?: number;
  className?: string;
}

/**
 * Pure freestanding Google Photos-inspired 4-petal pinwheel / aperture shutter mark.
 * INVARIANT: Must NEVER be enclosed inside a card, square, rounded box, or squircle.
 */
export function FramelyLogo({ size = 32, className = '' }: FramelyLogoProps) {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`framely-red-${id}`} x1="10" y1="4" x2="26" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF5252" />
          <stop offset="100%" stopColor="#D93025" />
        </linearGradient>
        <linearGradient id={`framely-yellow-${id}`} x1="4" y1="24" x2="24" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FBBC04" />
          <stop offset="100%" stopColor="#F29900" />
        </linearGradient>
        <linearGradient id={`framely-blue-${id}`} x1="24" y1="14" x2="44" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#0B57D0" />
        </linearGradient>
        <linearGradient id={`framely-green-${id}`} x1="24" y1="24" x2="36" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34A853" />
          <stop offset="100%" stopColor="#188038" />
        </linearGradient>
      </defs>

      {/* Top petal — Crimson Coral */}
      <path
        d="M24 24H12.5C12.5 14.3 17.6 6.5 24 4.2V24Z"
        fill={`url(#framely-red-${id})`}
      />
      {/* Right petal — Cobalt Blue */}
      <path
        d="M24 24V12.5C33.7 12.5 41.5 17.6 43.8 24H24Z"
        fill={`url(#framely-blue-${id})`}
      />
      {/* Bottom petal — Emerald Green */}
      <path
        d="M24 24H35.5C35.5 33.7 30.4 41.5 24 43.8V24Z"
        fill={`url(#framely-green-${id})`}
      />
      {/* Left petal — Amber Gold */}
      <path
        d="M24 24V35.5C14.3 35.5 6.5 30.4 4.2 24H24Z"
        fill={`url(#framely-yellow-${id})`}
      />
      {/* Crisp center shutter eye */}
      <circle cx="24" cy="24" r="3.4" fill="white" fillOpacity="0.92" />
    </svg>
  );
}
