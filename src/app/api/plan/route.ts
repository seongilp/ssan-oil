import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mapWithLimit } from '@/lib/concurrency';
import { loadStations } from '@/lib/fuel/stations';
import { selectCandidates } from '@/lib/route/candidates';
import { evaluate, rank, type Evaluation } from '@/lib/route/cost';
import { fetchRoute } from '@/lib/route/osrm';
import { formatZodError, planRequestSchema } from '@/lib/schemas';

/**
 * 경로에서 이 거리(km) 밖의 주유소는 애초에 후보가 아니다.
 * 전국 1만 곳을 다루게 되면서 회랑을 좁혀도 후보가 충분하다.
 */
const CORRIDOR_KM = 5;
/** 실제 우회 경로를 계산할 최대 후보 수. OSRM 호출량과 직결된다. */
const MAX_CANDIDATES = 15;
const OSRM_CONCURRENCY = 3;

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = planRequestSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError ? formatZodError(error) : '요청 본문이 올바르지 않다.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const { origin, destination, fuel, ...params } = parsed;

    const [baseRoute, stations] = await Promise.all([
      fetchRoute([origin, destination]),
      loadStations(fuel),
    ]);

    const candidates = selectCandidates(
      stations,
      baseRoute,
      fuel,
      CORRIDOR_KM,
      MAX_CANDIDATES,
      params,
    );

    const evaluated = await mapWithLimit(
      candidates,
      OSRM_CONCURRENCY,
      async (candidate): Promise<Evaluation | null> => {
        const coord = candidate.station.coord;
        if (!coord) return null;
        try {
          const via = await fetchRoute([origin, coord, destination]);
          return evaluate(candidate.station, candidate.price, baseRoute, via, params);
        } catch {
          // 개별 후보의 경로 계산 실패로 전체 응답을 버리지 않는다.
          return null;
        }
      },
    );

    const withinBudget = evaluated
      .filter((item): item is Evaluation => item !== null)
      .filter((item) => item.extraMinutes <= params.maxDetourMinutes);

    const ranked = rank(withinBudget);
    // '가장 비싼 선택 대비 얼마나 아꼈는가'를 절감액으로 제시한다.
    const worstCost = ranked.length > 0 ? ranked[ranked.length - 1].totalCost : 0;

    return NextResponse.json({
      base: {
        distanceKm: baseRoute.distanceMeters / 1000,
        durationMinutes: baseRoute.durationSeconds / 60,
        geometry: baseRoute.geometry,
      },
      stationsConsidered: candidates.length,
      results: ranked.map((item) => ({
        id: item.station.id,
        name: item.station.name,
        brand: item.station.brand,
        address: item.station.address,
        routeName: item.station.highway?.routeName ?? null,
        direction: item.station.highway?.direction ?? null,
        coord: item.station.coord,
        price: item.price,
        extraKm: item.extraKm,
        extraMinutes: item.extraMinutes,
        fuelCost: item.fuelCost,
        detourCost: item.detourCost,
        totalCost: item.totalCost,
        savingVsWorst: worstCost - item.totalCost,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
