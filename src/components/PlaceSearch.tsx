'use client';

import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Place } from '@/lib/api-types';
import { cn } from '@/lib/utils';

type Props = {
  readonly label: string;
  readonly placeholder: string;
  readonly tone: 'origin' | 'destination';
  readonly value: Place | null;
  readonly onChange: (place: Place | null) => void;
};

/** 긴 Nominatim display_name에서 앞쪽 2~3 토큰만 남겨 읽기 쉽게 만든다. */
function shortLabel(label: string): string {
  const parts = label.split(',').map((part) => part.trim());
  return parts.slice(0, 3).join(', ');
}

export default function PlaceSearch({
  label,
  placeholder,
  tone,
  value,
  onChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<readonly Place[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function search() {
    const trimmed = query.trim();
    if (trimmed === '') return;
    setStatus('loading');
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
      const data = (await response.json()) as { places?: Place[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? '검색 실패');
      setPlaces(data.places ?? []);
      setStatus('idle');
    } catch {
      setPlaces([]);
      setStatus('error');
    }
  }

  const dot = (
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        tone === 'origin' ? 'bg-muted-foreground' : 'bg-primary',
      )}
    />
  );

  if (value) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5">
        {dot}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
          <div className="truncate text-sm font-medium">{shortLabel(value.label)}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full"
          aria-label={`${label} 지우기`}
          onClick={() => onChange(null)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-muted/60 p-2">
      <div className="flex items-center gap-2.5 px-1">
        {dot}
        <label
          className="text-[11px] font-medium text-muted-foreground"
          htmlFor={`search-${tone}`}
        >
          {label}
        </label>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Input
          id={`search-${tone}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search();
            }
          }}
          placeholder={placeholder}
          className="h-9 border-0 bg-background shadow-none"
        />
        <Button
          size="icon"
          variant="secondary"
          className="size-9 shrink-0"
          aria-label={`${label} 검색`}
          onClick={() => void search()}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
        </Button>
      </div>

      {status === 'error' && (
        <p className="mt-2 px-1 text-xs text-destructive">
          검색에 실패했다. 잠시 후 다시 시도.
        </p>
      )}

      {places.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {places.map((place) => (
            <li key={`${place.lat},${place.lon}`}>
              <button
                type="button"
                onClick={() => {
                  onChange(place);
                  setPlaces([]);
                  setQuery('');
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-background"
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs leading-snug">{shortLabel(place.label)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
