'use client';

import '@/lib/polyfills';
import React, { useCallback, useEffect, useState } from 'react';
import type { ThemeMode } from '@/lib/types';
import { LandingPage } from './LandingPage';
import { PhotoGalleryApp } from './PhotoGalleryApp';

const THEME_STORAGE_KEY = 'framely_theme_mode';

function applyThemeToDocument(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('dark', 'oled');
  if (mode === 'dark') {
    root.classList.add('dark');
  } else if (mode === 'oled') {
    root.classList.add('dark', 'oled');
  }
}

export function FramelyClientShell() {
  // Default theme MUST be pristine Google Photos Light / White Mode
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [view, setView] = useState<'landing' | 'app'>('landing');
  const [openAuthOnLaunch, setOpenAuthOnLaunch] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    const resolvedTheme: ThemeMode =
      saved === 'light' || saved === 'dark' || saved === 'oled' ? saved : 'light';
    applyThemeToDocument(resolvedTheme);

    const params = new URLSearchParams(window.location.search);
    const shouldAutostart = params.get('autostart') === '1' || params.get('app') === '1';

    const frame = window.requestAnimationFrame(() => {
      if (resolvedTheme !== 'light') {
        setTheme(resolvedTheme);
      }
      if (shouldAutostart) {
        setView('app');
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const handleSetTheme = useCallback((next: ThemeMode) => {
    setTheme(next);
    applyThemeToDocument(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  }, []);

  const handleCycleTheme = useCallback(() => {
    const next: ThemeMode =
      theme === 'light' ? 'dark' : theme === 'dark' ? 'oled' : 'light';
    handleSetTheme(next);
  }, [handleSetTheme, theme]);

  const handleLaunchApp = useCallback((openAuth = false) => {
    setOpenAuthOnLaunch(openAuth);
    setView('app');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  const handleReturnToLanding = useCallback(() => {
    setOpenAuthOnLaunch(false);
    setView('landing');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  if (view === 'app') {
    return (
      <PhotoGalleryApp
        theme={theme}
        onCycleTheme={handleCycleTheme}
        onSetTheme={handleSetTheme}
        onReturnToLanding={handleReturnToLanding}
        openAuthOnMount={openAuthOnLaunch}
      />
    );
  }

  return (
    <LandingPage
      theme={theme}
      onCycleTheme={handleCycleTheme}
      onLaunchApp={handleLaunchApp}
    />
  );
}
