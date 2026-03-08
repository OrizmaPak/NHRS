function escapeCsvValue(value: unknown): string {
  const raw = String(value ?? '');
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export function exportRowsToCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(','));
  const content = [header, ...lines].join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportRowsToExcelLike(filename: string, rows: Array<Record<string, unknown>>) {
  // Fallback strategy: deliver CSV with xls extension for broad compatibility.
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const header = columns.join('\t');
  const lines = rows.map((row) => columns.map((column) => String(row[column] ?? '')).join('\t'));
  const content = [header, ...lines].join('\n');
  const blob = new Blob([content], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}
