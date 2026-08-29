import { NextResponse } from 'next/server';
import { z } from 'zod';
import { formatZodError, geocodeQuerySchema } from '@/lib/schemas';
import { CACHE_HEADERS } from '@/lib/http-cache';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * 주소/장소명 → 좌표. Nominatim 이용정책상 식별 가능한 User-Agent가 필요해서
 * 브라우저에서 직접 부르지 않고 서버를 거친다.
 */
export async function GET(request: Request) {
  let query: string;
  try {
    query = geocodeQuerySchema.parse({
      q: new URL(request.url).searchParams.get('q') ?? '',
    }).q;
  } catch (error) {
    const message =
      error instanceof z.ZodError ? formatZodError(error) : '검색어가 올바르지 않다.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'kr');
    url.searchParams.set('accept-language', 'ko');

    const response = await fetch(url, {
      headers: {
        'User-Agent': `datalab-fuel-router/0.1 (${process.env.OSM_CONTACT ?? 'unknown'})`,
      },
      next: { revalidate: 86400 },
    });
    if (!response.ok) throw new Error(`Nominatim 응답 실패: HTTP ${response.status}`);

    const raw = (await response.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
    }>;

    const places = raw
      .map((item) => ({
        label: item.display_name ?? '',
        lat: Number.parseFloat(item.lat ?? ''),
        lon: Number.parseFloat(item.lon ?? ''),
      }))
      .filter(
        (item) =>
          item.label !== '' && Number.isFinite(item.lat) && Number.isFinite(item.lon),
      );

    return NextResponse.json(
      { places },
      { headers: { 'Cache-Control': CACHE_HEADERS.geocode } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
