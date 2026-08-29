const KRW = new Intl.NumberFormat('ko-KR');

export const formatWon = (value: number): string => `${KRW.format(Math.round(value))}원`;

export const formatKm = (value: number): string => `${value.toFixed(1)}km`;

export const formatMinutes = (value: number): string => `${Math.round(value)}분`;
