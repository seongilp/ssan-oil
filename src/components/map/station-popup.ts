/**
 * 마커 팝업 내용을 DOM으로 직접 만든다.
 * 주유소 이름은 외부 데이터라 innerHTML로 넣지 않고 textContent로만 채운다.
 */
export type PopupStation = {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly address: string;
  readonly isSelf: boolean;
  readonly price: number;
  readonly coord: { lat: number; lon: number };
};

function line(className: string, text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

export function buildStationPopup(station: PopupStation): HTMLElement {
  const root = document.createElement('div');
  root.className = 'min-w-[190px] space-y-1.5 p-0.5';

  const header = document.createElement('div');
  header.className = 'flex items-baseline justify-between gap-2';
  header.append(
    line('text-sm font-semibold text-slate-900', station.name),
    line('shrink-0 text-sm font-bold tabular-nums text-slate-900', `${station.price.toLocaleString('ko-KR')}원`),
  );
  root.append(header);

  const meta = [station.brand, station.isSelf ? '셀프' : null]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  if (meta) root.append(line('text-[11px] text-slate-500', meta));
  if (station.address) root.append(line('text-[11px] text-slate-500', station.address));

  // 실제 길안내는 카카오맵에 맡긴다. 좌표만 있으면 되고 API 키가 필요 없다.
  const link = document.createElement('a');
  link.href = `https://map.kakao.com/link/to/${encodeURIComponent(station.name)},${station.coord.lat},${station.coord.lon}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '카카오맵에서 길안내 →';
  link.className =
    'mt-1 inline-block text-[11px] font-medium text-blue-600 underline underline-offset-2';
  root.append(link);

  return root;
}
