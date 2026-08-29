import { z } from 'zod';

/** 경계에서의 입력 검증. 스키마 하나로 파싱과 타입을 동시에 얻는다. */
export const coordSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});

export const fuelTypeSchema = z.enum(['gasoline', 'diesel', 'lpg']);

export const planRequestSchema = z.object({
  origin: coordSchema,
  destination: coordSchema,
  fuel: fuelTypeSchema,
  liters: z.number().finite().min(1).max(200),
  efficiencyKmPerL: z.number().finite().min(1).max(50),
  maxDetourMinutes: z.number().finite().min(0).max(120),
});

/** 저장소에 있는 연료 종류. CSV가 5종을 주므로 경로 계산용 3종보다 넓다. */
export const storeFuelSchema = z.enum([
  'gasoline',
  'diesel',
  'lpg',
  'premium',
  'kerosene',
]);

/** 지도 뷰포트 조회. 좌표 순서 오류를 잡기 위해 west<east, south<north를 강제한다. */
export const boundsSchema = z
  .object({
    west: z.coerce.number().min(-180).max(180),
    south: z.coerce.number().min(-90).max(90),
    east: z.coerce.number().min(-180).max(180),
    north: z.coerce.number().min(-90).max(90),
  })
  .refine((b) => b.west < b.east, { message: 'west는 east보다 작아야 한다.' })
  .refine((b) => b.south < b.north, { message: 'south는 north보다 작아야 한다.' });

export const stationsQuerySchema = z.object({
  bounds: boundsSchema,
  fuel: storeFuelSchema,
  limit: z.coerce.number().int().min(1).max(500),
});

export const geocodeQuerySchema = z.object({
  q: z.string().trim().min(1, '검색어가 필요하다.').max(200),
});

export type PlanRequest = z.infer<typeof planRequestSchema>;

/** Zod 이슈를 사용자에게 보여줄 한 줄 메시지로 압축한다. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join(', ');
}
