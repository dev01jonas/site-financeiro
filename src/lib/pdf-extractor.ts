import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface ExtractedRecord {
  name: string;
  dueDate: string;
  amount: number;
  email?: string;
  description?: string;
}

function decodeHtmlEntities(value: string) {
  if (!value || !/[&][#a-zA-Z0-9]+;/.test(value)) {
    return value;
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function normalizeName(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*.*/, '')
    .replace(/\s*(?:\.{3}|…)\s*$/, '')
    .trim();
}

function normalizeComparableText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseAmount(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const amount = Number.parseFloat(normalized);
  return Number.isNaN(amount) ? 0 : amount;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseExcelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString('pt-BR');
  }

  if (typeof value === 'number' && value > 0) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.d && parsed?.m && parsed?.y) {
      return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
    }
  }

  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const brDate = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (brDate) {
    const [, day, month, year] = brDate;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${fullYear}`;
  }

  const isoDate = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }

  return text;
}

function parseFinancialText(text: string): ExtractedRecord[] {
  const records: ExtractedRecord[] = [];
  const pattern1 =
    /([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-Úa-zà-ú]+)*)\s+(\d{2}\/\d{2}\/\d{4})\s+R?\$?\s*([\d.,]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern1.exec(text)) !== null) {
    const name = normalizeName(match[1]);
    const dueDate = match[2];
    const amount = parseAmount(match[3]);

    if (name.length > 3 && amount > 0) {
      records.push({ name, dueDate, amount });
    }
  }

  if (records.length > 0) {
    return records;
  }

  const lines = text.split('\n').filter((line) => line.trim());
  for (const line of lines) {
    const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})/);
    const amountMatch = line.match(/R?\$?\s*([\d]{1,3}(?:\.?\d{3})*,\d{2})/);

    if (!dateMatch || !amountMatch) {
      continue;
    }

    const beforeDate = line.substring(0, line.indexOf(dateMatch[0])).trim();
    const name = normalizeName(beforeDate.replace(/^\d+\s*[-.]?\s*/, '').trim());
    const amount = parseAmount(amountMatch[1]);

    if (name.length > 3 && amount > 0) {
      records.push({
        name,
        dueDate: dateMatch[1],
        amount,
      });
    }
  }

  return records;
}

function isLikelyClientName(line: string) {
  const normalized = line.trim();
  const comparable = normalizeComparableText(normalized);

  if (!normalized || normalized.length < 4) return false;
  if (comparable.length < 4) return false;
  if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(normalized)) return false;
  if (/^descricao\b/i.test(comparable)) return false;
  if (/\bvalor\b/i.test(comparable) && /\bparcela\b/i.test(comparable)) return false;
  if (normalized.includes(':')) return false;

  const blockedHeaders = [
    'total',
    'relatorio de contas a receber',
    'modaelli advogados associados',
    'usuario',
    'data hora',
    'cliente processo',
    'vencimento',
    'pagamento',
    'centro de receita',
    'forma de',
    'forma de pgmto',
    'pgmto',
    'status',
    'descricao',
  ];

  if (blockedHeaders.some((header) => comparable === header || comparable.startsWith(`${header} `))) {
    return false;
  }

  if (/(honorarios|pix|vencido|centro de receita|processo adm|aguardando numeracao|interposicao de recurso|atuacao extrajudicial|parcela|valor)/i.test(comparable)) {
    return false;
  }

  const tokens = comparable.split(' ').filter(Boolean);
  if (tokens.length < 2) return false;

  const lastToken = tokens[tokens.length - 1];
  if (['de', 'da', 'do', 'dos', 'das', 'e'].includes(lastToken)) return false;

  return /[A-Za-zÀ-ÿ]/.test(normalized);
}

function parseIntegraPdfLines(lines: string[]): ExtractedRecord[] {
  const records: ExtractedRecord[] = [];
  let currentName = '';
  let currentDueDate = '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (isLikelyClientName(line) && !currentName) {
      currentName = normalizeName(line);
      currentDueDate = '';
      continue;
    }

    const dateMatch = line.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
    if (dateMatch && currentName) {
      currentDueDate = dateMatch[1];
    }

    const detailMatch = line.match(/Descri[cç][aã]o:\s*(.+?)\s+Valor:\s*R?\$?\s*([\d.,]+)/i);
    if (detailMatch && currentName && currentDueDate) {
      const [, description, amountValue] = detailMatch;
      const amount = parseAmount(amountValue);
      if (amount > 0) {
        records.push({
          name: currentName,
          dueDate: currentDueDate,
          amount,
          description: description.trim(),
        });
      }
      currentName = '';
      currentDueDate = '';
    }
  }

  return records;
}

function buildPdfLines(items: Array<{ str?: string; transform?: number[] }>) {
  const lines: string[] = [];
  let currentY: number | null = null;
  let currentParts: string[] = [];

  for (const item of items) {
    const text = String(item.str || '').trim();
    if (!text) continue;

    const y = Array.isArray(item.transform) ? Number(item.transform[5]) : currentY ?? 0;
    if (currentY !== null && Math.abs(y - currentY) > 2) {
      const built = currentParts.join(' ').replace(/\s+/g, ' ').trim();
      if (built) lines.push(built);
      currentParts = [text];
      currentY = y;
      continue;
    }

    currentParts.push(text);
    currentY = y;
  }

  const lastLine = currentParts.join(' ').replace(/\s+/g, ' ').trim();
  if (lastLine) lines.push(lastLine);

  return lines;
}

function normalizeHeader(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCell(value: unknown) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    return value;
  }

  return decodeHtmlEntities(String(value ?? '')).replace(/\s+/g, ' ').trim();
}

function findColumnIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.some((alias) => header === alias || header.includes(alias)));
}

function mapRowsToBillingRecords(rows: unknown[][]): ExtractedRecord[] {
  if (rows.length === 0) {
    return [];
  }

  const headerCandidates = rows
    .map((row, rowIndex) => {
      const headers = row.map((cell) => normalizeHeader(cell));
      const nameIndex = findColumnIndex(headers, ['cliente', 'nome', 'sacado', 'devedor', 'pagador', 'contratante']);
      const dueDateIndex = findColumnIndex(headers, ['vencimento', 'data vencimento', 'dt vencimento', 'venc.', 'dt venc']);
      const amountIndex = findColumnIndex(headers, ['valor', 'vlr', 'total', 'saldo', 'parcela', 'honorario', 'honorarios']);
      const descriptionIndex = findColumnIndex(headers, ['descricao', 'descrição', 'detalhe', 'parcela', 'observacao', 'observação']);
      const emailIndex = findColumnIndex(headers, ['email', 'e-mail', 'mail', 'correio']);
      const score = [nameIndex, dueDateIndex, amountIndex].filter((index) => index !== -1).length;
      return { rowIndex, nameIndex, dueDateIndex, amountIndex, descriptionIndex, emailIndex, score };
    })
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex);

  const header = headerCandidates[0];
  if (!header) {
    return parseRowsWithoutHeaders(rows);
  }

  if (header.nameIndex === -1 || header.dueDateIndex === -1 || header.amountIndex === -1) {
    return parseRowsWithoutHeaders(rows.slice(header.rowIndex + 1));
  }

  return rows
    .slice(header.rowIndex + 1)
    .map((columns) => {
      const name = normalizeName(String(normalizeCell(columns[header.nameIndex]) || ''));
      const dueDate = parseExcelDate(columns[header.dueDateIndex]);
      const amountCell = normalizeCell(columns[header.amountIndex]);
      const amount = typeof amountCell === 'number' ? amountCell : parseAmount(String(amountCell || ''));
      const description = header.descriptionIndex >= 0 ? String(normalizeCell(columns[header.descriptionIndex]) || '') : '';
      const email = header.emailIndex >= 0 ? String(normalizeCell(columns[header.emailIndex]) || '').trim().toLowerCase() : '';
      return { name, dueDate, amount, description: description || undefined, email: isValidEmail(email) ? email : undefined };
    })
    .filter((record) => record.name.length > 3 && /^\d{2}\/\d{2}\/\d{4}$/.test(record.dueDate) && record.amount > 0);
}

function parseRowsWithoutHeaders(rows: unknown[][]): ExtractedRecord[] {
  return rows
    .map((columns) => {
      const normalizedColumns = columns.map((column) => normalizeCell(column));
      const dueDateIndex = normalizedColumns.findIndex((column) => /^\d{2}\/\d{2}\/\d{4}$/.test(parseExcelDate(column)));
      const amountIndex = normalizedColumns.findIndex((column, index) => {
        if (index === dueDateIndex) {
          return false;
        }

        if (typeof column === 'number') {
          return column > 0;
        }

        return parseAmount(String(column || '')) > 0;
      });

      if (dueDateIndex === -1 || amountIndex === -1) {
        return null;
      }

      const nameCell = normalizedColumns.find((column, index) => {
        if (index === dueDateIndex || index === amountIndex) {
          return false;
        }

        const text = String(column || '').trim();
        return text.length > 3 && /[A-Za-zÀ-ÿ]/.test(text);
      });

      const amountCell = normalizedColumns[amountIndex];
      const amount = typeof amountCell === 'number' ? amountCell : parseAmount(String(amountCell || ''));
      const dueDate = parseExcelDate(normalizedColumns[dueDateIndex]);
      const name = normalizeName(String(nameCell || ''));
      const emailCell = normalizedColumns.find((column) => isValidEmail(String(column || '').trim()));
      const email = String(emailCell || '').trim().toLowerCase();
      const descriptionCell = normalizedColumns.find((column, index) => {
        if (index === dueDateIndex || index === amountIndex) {
          return false;
        }

        const text = String(column || '').trim();
        return /parcela|descri|observa/i.test(text);
      });

      return {
        name,
        dueDate,
        amount,
        description: descriptionCell ? String(descriptionCell).trim() : undefined,
        email: isValidEmail(email) ? email : undefined,
      };
    })
    .filter((record): record is ExtractedRecord => {
      return !!record && record.name.length > 3 && /^\d{2}\/\d{2}\/\d{4}$/.test(record.dueDate) && record.amount > 0;
    });
}

async function extractFromPDF(file: File): Promise<ExtractedRecord[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  const allLines: string[] = [];
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    const pageLines = buildPdfLines(content.items as Array<{ str?: string; transform?: number[] }>);
    allLines.push(...pageLines);
    const pageText = pageLines.join('\n');
    fullText += `${pageText}\n`;
  }

  const reportRecords = parseIntegraPdfLines(allLines);
  if (reportRecords.length > 0) {
    return reportRecords;
  }

  return parseFinancialText(fullText);
}

function extractFromSpreadsheetHTML(html: string): ExtractedRecord[] {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');
  const rows = Array.from(document.querySelectorAll('table tr')).map((row) =>
    Array.from(row.querySelectorAll('td, th')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || ''),
  );

  return mapRowsToBillingRecords(rows);
}

async function extractFromSpreadsheetFile(file: File): Promise<ExtractedRecord[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    cellDates: true,
    raw: true,
  });

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    }).map((row) => row.map(normalizeCell));

    const records = mapRowsToBillingRecords(rows);
    if (records.length > 0) {
      return records;
    }
  }

  return [];
}

function findCompanionHtml(files: File[], indexFileName?: string) {
  const exactSheet = files.find((file) => file.name.toLowerCase() === 'sheet001.htm');
  if (exactSheet) {
    return exactSheet;
  }

  if (!indexFileName) {
    return files.find((file) => {
      const lower = file.name.toLowerCase();
      return lower.endsWith('.htm') || lower.endsWith('.html');
    });
  }

  const indexBaseName = indexFileName.replace(/\.[^.]+$/, '').toLowerCase();
  return files.find((file) => {
    const lower = file.name.toLowerCase();
    return (lower.endsWith('.htm') || lower.endsWith('.html')) && (lower.includes('sheet') || lower.includes(indexBaseName));
  });
}

async function extractBillingRecordsFromSingleFile(file: File): Promise<ExtractedRecord[]> {
  const fileName = file.name.toLowerCase();

  if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
    return extractFromPDF(file);
  }

  if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
    const records = await extractFromSpreadsheetFile(file);

    if (records.length > 0) {
      return records;
    }

    const text = await file.text();
    const htmlRecords = extractFromSpreadsheetHTML(text);
    if (htmlRecords.length > 0) {
      return htmlRecords;
    }

    throw new Error('Não foi possível ler os dados do arquivo Excel.');
  }

  if (fileName.endsWith('.html') || fileName.endsWith('.htm') || file.type.includes('html')) {
    const text = await file.text();
    const records = extractFromSpreadsheetHTML(text);

    if (records.length > 0) {
      return records;
    }

    throw new Error('Não foi possível encontrar cliente, vencimento e valor nesse HTML.');
  }

  throw new Error('Formato de arquivo não suportado.');
}

export async function extractBillingRecords(filesOrFile: File | File[]): Promise<ExtractedRecord[]> {
  const files = Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile];

  if (files.length === 0) {
    throw new Error('Nenhum arquivo foi enviado.');
  }

  const pdfFile = files.find((file) => file.name.toLowerCase().endsWith('.pdf'));
  if (pdfFile) {
    return extractBillingRecordsFromSingleFile(pdfFile);
  }

  const htmlFile = files.find((file) => {
    const lower = file.name.toLowerCase();
    return lower.endsWith('.htm') || lower.endsWith('.html');
  });

  if (htmlFile && files.length === 1) {
    return extractBillingRecordsFromSingleFile(htmlFile);
  }

  const excelFile = files.find((file) => {
    const lower = file.name.toLowerCase();
    return lower.endsWith('.xls') || lower.endsWith('.xlsx');
  });

  if (excelFile) {
    try {
      return await extractBillingRecordsFromSingleFile(excelFile);
    } catch {
      const companionHtml = findCompanionHtml(files, excelFile.name);
      if (companionHtml) {
        return extractBillingRecordsFromSingleFile(companionHtml);
      }

      throw new Error(
        'Não foi possível ler esse Excel. Confira se a planilha tem colunas de cliente, vencimento e valor.',
      );
    }
  }

  if (htmlFile) {
    return extractBillingRecordsFromSingleFile(htmlFile);
  }

  throw new Error('Formato de arquivo não suportado.');
}
