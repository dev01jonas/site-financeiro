import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface ExtractedRecord {
  name: string;
  dueDate: string;
  amount: number;
}

function normalizeName(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*.*/, '')
    .trim();
}

function parseAmount(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const amount = Number.parseFloat(normalized);
  return Number.isNaN(amount) ? 0 : amount;
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

function normalizeHeader(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mapRowsToBillingRecords(rows: string[][]): ExtractedRecord[] {
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((cell) => normalizeHeader(cell));
  const nameIndex = headers.findIndex((value) => value.includes('cliente'));
  const dueDateIndex = headers.findIndex((value) => value.includes('vencimento'));
  const amountIndex = headers.findIndex((value) => value.includes('valor'));

  if (nameIndex === -1 || dueDateIndex === -1 || amountIndex === -1) {
    return [];
  }

  return rows
    .slice(1)
    .map((columns) => {
      const name = normalizeName(columns[nameIndex] || '');
      const dueDate = String(columns[dueDateIndex] || '').trim();
      const amount = parseAmount(String(columns[amountIndex] || ''));
      return { name, dueDate, amount };
    })
    .filter((record) => record.name.length > 3 && /^\d{2}\/\d{2}\/\d{4}$/.test(record.dueDate) && record.amount > 0);
}

async function extractFromPDF(file: File): Promise<ExtractedRecord[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    fullText += `${pageText}\n`;
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
    cellDates: false,
    raw: false,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }).map((row) => row.map((cell) => String(cell ?? '').trim()));

  return mapRowsToBillingRecords(rows);
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

    throw new Error('Nao foi possivel ler os dados do arquivo Excel.');
  }

  if (fileName.endsWith('.html') || fileName.endsWith('.htm') || file.type.includes('html')) {
    const text = await file.text();
    const records = extractFromSpreadsheetHTML(text);

    if (records.length > 0) {
      return records;
    }

    throw new Error('Nao foi possivel encontrar cliente, vencimento e valor nesse HTML.');
  }

  throw new Error('Formato de arquivo nao suportado.');
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
        'Nao foi possivel ler o XLS sozinho. Envie o arquivo .xls junto com o sheet001.htm da pasta auxiliar.',
      );
    }
  }

  if (htmlFile) {
    return extractBillingRecordsFromSingleFile(htmlFile);
  }

  throw new Error('Formato de arquivo nao suportado.');
}
