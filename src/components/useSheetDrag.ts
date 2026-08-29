'use client';

import { useCallback, useRef, useState, type PointerEvent } from 'react';

/** 접었을 때 남기는 높이(px). 손잡이와 헤더만 보인다. */
export const COLLAPSED_PX = 88;
/** 펼쳤을 때 차지하는 화면 비율. */
const EXPANDED_RATIO = 0.78;
/** 이보다 적게 움직이면 드래그가 아니라 탭으로 본다. */
const TAP_THRESHOLD_PX = 6;

const expandedHeight = (): number =>
  typeof window === 'undefined' ? 600 : window.innerHeight * EXPANDED_RATIO;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

type Result = {
  /** 드래그 중일 때만 값이 있다. 이 동안은 CSS 트랜지션을 끈다. */
  readonly dragHeight: number | null;
  readonly isDragging: boolean;
  readonly handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  };
};

/**
 * 바텀시트 손잡이를 끌어 여닫는다.
 *
 * 끄는 동안에는 높이를 손가락에 맞춰 직접 준다. 손을 떼면 이동 거리와 방향으로
 * 열지 닫을지 정한다. 거의 안 움직였으면 탭으로 보고 그냥 토글한다.
 */
export function useSheetDrag(
  open: boolean,
  setOpen: (open: boolean) => void,
): Result {
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const movedRef = useRef(0);
  /**
   * 드래그 여부와 현재 높이는 ref로 들고 간다.
   * 상태만 쓰면 pointermove가 리렌더 전에 연달아 들어올 때 이전 값을 보고
   * 이벤트를 흘려버린다.
   */
  const activeRef = useRef(false);
  const heightRef = useRef(0);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      // 마우스 오른쪽 버튼 등은 무시한다.
      if (event.button !== 0) return;
      // 포인터 캡처는 손가락이 손잡이 밖으로 나가도 이벤트를 계속 받기 위한 것이다.
      // 실패해도 드래그 자체는 되어야 하므로 막지 않는다.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 캡처를 지원하지 않는 환경은 그냥 진행한다.
      }
      startYRef.current = event.clientY;
      startHeightRef.current = open ? expandedHeight() : COLLAPSED_PX;
      movedRef.current = 0;
      activeRef.current = true;
      heightRef.current = startHeightRef.current;
      setDragHeight(startHeightRef.current);
    },
    [open],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!activeRef.current) return;
      const delta = event.clientY - startYRef.current;
      movedRef.current = delta;
      // 아래로 끌면(delta > 0) 시트가 낮아진다.
      const next = clamp(
        startHeightRef.current - delta,
        COLLAPSED_PX,
        expandedHeight(),
      );
      heightRef.current = next;
      setDragHeight(next);
    },
    [],
  );

  const finish = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // 캡처가 없었으면 해제할 것도 없다.
      }

      const moved = movedRef.current;
      if (Math.abs(moved) < TAP_THRESHOLD_PX) {
        // 사실상 제자리 = 탭. 현재 상태를 뒤집는다.
        setOpen(!open);
      } else {
        // 절반을 넘겼는지로 판정한다. 조금만 끌었으면 원래 상태로 되돌아간다.
        const midpoint = (COLLAPSED_PX + expandedHeight()) / 2;
        setOpen(heightRef.current >= midpoint);
      }
      setDragHeight(null);
    },
    [open, setOpen],
  );

  return {
    dragHeight,
    isDragging: dragHeight !== null,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
