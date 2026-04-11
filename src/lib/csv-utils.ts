import type { BillingRecord } from '@/types/billing';

type ParsedClient = {
  name: string;
  email: string;
  phone?: string;
};

function escapeCSVCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function splitCSVLine(line: string, separator: string) {
  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === separator && !insideQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function sanitizeCell(value: string) {
  const trimmed = value.replace(/^\uFEFF/, '').trim();
  return trimmed === '-' ? '' : trimmed;
}

function detectSeparator(headerLine: string) {
  const separators = [';', ',', '\t'];
  const best = separators
    .map((separator) => ({ separator, count: (headerLine.match(new RegExp(`\\${separator}`, 'g')) || []).length }))
    .sort((a, b) => b.count - a.count)[0];

  return best && best.count > 0 ? best.separator : ',';
}

function normalizeImportedPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits : '';
}

function cleanImportedName(rawName: string) {
  const withoutSlashTail = rawName.split('/')[0] || rawName;
  const withoutProcessTokens = withoutSlashTail.replace(/\b\d[\d.\-\/]{6,}\b/g, ' ');
  const lettersOnly = withoutProcessTokens.replace(/[^A-Za-zÀ-ÿ' -]/g, ' ');
  return lettersOnly.replace(/\s+/g, ' ').trim();
}

function isLikelyPersonName(name: string) {
  if (!name) {
    return false;
  }

  const letters = (name.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const digits = (name.match(/\d/g) || []).length;
  const words = name.split(/\s+/).filter(Boolean);

  return letters >= 3 && digits === 0 && words.length >= 2;
}

export function exportToCSV(records: BillingRecord[]): string {
  const header = 'Nome,E-mail,Data Vencimento,Valor,Status\n';
  const rows = records
    .map((record) =>
      [
        escapeCSVCell(record.client_name),
        escapeCSVCell(record.client_email || ''),
        escapeCSVCell(record.due_date),
        escapeCSVCell(record.amount.toFixed(2).replace('.', ',')),
        escapeCSVCell(record.status),
      ].join(','),
    )
    .join('\n');

  return header + rows;
}

export function downloadCSV(records: BillingRecord[], filename = 'cobrancas.csv') {
  const csv = exportToCSV(records);
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function copyToClipboard(records: BillingRecord[]) {
  const rows = records.map(
    (record) =>
      `${record.client_name}\t${record.client_email || ''}\t${record.due_date}\t${record.amount
        .toFixed(2)
        .replace('.', ',')}\t${record.status}`,
  );
  const header = 'Nome\tE-mail\tData Vencimento\tValor\tStatus';
  const text = `${header}\n${rows.join('\n')}`;
  navigator.clipboard.writeText(text);
}

export function parseClientCSV(csvText: string): ParsedClient[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const separator = detectSeparator(lines[0]);
  const headers = splitCSVLine(lines[0].toLowerCase(), separator).map((header) => sanitizeCell(header.replace(/"/g, '')));

  const nameIndex = headers.findIndex((header) => header.includes('nome') || header === 'name' || header.includes('cliente'));
  const emailIndex = headers.findIndex((header) => header.includes('email') || header.includes('e-mail') || header.includes('mail'));
  const phoneIndex = headers.findIndex(
    (header) => header.includes('telefone') || header.includes('phone') || header.includes('tel') || header.includes('celular'),
  );

  if (nameIndex === -1) {
    return [];
  }

  return lines
    .slice(1)
    .map((line) => {
      const columns = splitCSVLine(line, separator).map(sanitizeCell);
      const rawName = columns[nameIndex] || '';
      const cleanedName = cleanImportedName(rawName);
      const email = emailIndex >= 0 ? (columns[emailIndex] || '').toLowerCase() : '';
      const phone = phoneIndex >= 0 ? normalizeImportedPhone(columns[phoneIndex] || '') : '';

      return {
        name: cleanedName,
        email,
        phone: phone || undefined,
      };
    })
    .filter((client) => isLikelyPersonName(client.name) && !!client.email);
}
