/**
 * 오피넷 CSV는 CP949로 인코딩되어 있고, 파일에 따라 값이 큰따옴표로 감싸여 있다.
 * 의존성 없이 이 두 가지만 처리하는 최소 파서를 둔다.
 */
export function decodeCp949(buffer: Buffer): string {
  // CP949는 EUC-KR의 확장이라 euc-kr 디코더가 대부분을 처리한다.
  return new TextDecoder('euc-kr').decode(buffer);
}

/** 큰따옴표 안의 쉼표를 보존하며 한 줄을 쪼갠다. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      // 따옴표 안의 "" 는 리터럴 큰따옴표다.
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

export type CsvRow = Readonly<Record<string, string>>;

/**
 * 헤더 기반으로 행을 객체화한다.
 * 헤더 이름에 섞여 있는 앞뒤 공백(' 품질관리협약주유소')도 정리한다.
 */
export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const rows: CsvRow[] = [];

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    // '기준 : 일간(...)' 같은 안내 행은 컬럼 수가 맞지 않으므로 건너뛴다.
    if (values.length < headers.length) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    rows.push(row);
  }

  return rows;
}
