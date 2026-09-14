import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ai-islands:theme';

/** What the document is currently stamped with, falling back to the system. */
function readTheme(): Theme {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped === 'dark' || stamped === 'light') return stamped;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * The active theme, and a way to change it.
 *
 * The island palettes are picked in JavaScript rather than CSS, so the renderer
 * needs the resolved value — not just a media query.
 */
export function useTheme(): { theme: Theme; setTheme: (t: Theme | 'system') => void; preference: Theme | 'system' } {
  const [preference, setPreference] = useState<Theme | 'system'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // Private browsing, or site data blocked. The system default is fine.
    }
    return 'system';
  });

  const [theme, setResolved] = useState<Theme>(readTheme);

  useEffect(() => {
    if (preference === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', preference);
    }
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Not being able to remember the choice is not worth failing over.
    }
    setResolved(readTheme());
  }, [preference]);

  // Follow the system while the preference is 'system'.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(readTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return { theme, setTheme: setPreference, preference };
}
