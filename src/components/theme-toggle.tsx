'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: '라이트', Icon: Sun },
  { value: 'system', label: '시스템', Icon: Monitor },
  { value: 'dark', label: '다크', Icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // 서버 렌더링 시점에는 실제 테마를 알 수 없어 하이드레이션 불일치가 난다.
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`${label} 테마`}
          aria-pressed={mounted ? theme === value : undefined}
          onClick={() => setTheme(value)}
          className={cn(
            'flex size-7 items-center justify-center rounded-full transition-colors',
            mounted && theme === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
