import { NextResponse } from 'next/server';
import { z } from 'zod';
import { formatZodError, stationsQuerySchema } from '@/lib/schemas';
import { latestPriceDate, priceStatsInBounds, stationsInBounds } from '@/lib/store/queries';
import { CACHE_HEADERS } from '@/lib/http-cache';

/** 지도에 한 번에 그릴 최대 마커 수. 넘으면 가격 낮은 순으로 잘린다. */
const DEFAULT_LIMIT = 200;

/**
 * 현재 보이는 지도 영역의 주유소를 반환한다.
 * 저장소(SQLite)만 읽으므로 외부 API 호출이 0이다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  let query;
  try {
    query = stationsQuerySchema.parse({
      bounds: {
        west: params.get('west'),
        south: params.get('south'),
        east: params.get('east'),
        north: params.get('north'),
      },
      fuel: params.get('fuel') ?? 'gasoline',
      limit: params.get('limit') ?? DEFAULT_LIMIT,
    });
  } catch (error) {
    const message =
      error instanceof z.ZodError ? formatZodError(error) : '조회 조건이 올바르지 않다.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const [stations, stats, priceDate] = await Promise.all([
      stationsInBounds(query.bounds, query.fuel, query.limit),
      priceStatsInBounds(query.bounds, query.fuel),
      latestPriceDate(),
    ]);
    return NextResponse.json(
      {
        priceDate,
        truncated: stats !== null && stats.count > stations.length,
        stats,
        stations,
      },
      { headers: { 'Cache-Control': CACHE_HEADERS.stations } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
