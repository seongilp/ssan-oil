import { NextResponse } from 'next/server';
import { storeStats } from '@/lib/store/queries';
import { CACHE_HEADERS } from '@/lib/http-cache';

/** 헤더에 표시할 저장소 현황. 지오코딩이 진행 중이면 확보 수가 계속 늘어난다. */
export async function GET() {
  try {
    return NextResponse.json(await storeStats(), {
      headers: { 'Cache-Control': CACHE_HEADERS.stats },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
