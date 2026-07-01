import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const LOG_SHEET_NAME = 'LOG_AUTOMACAO'
const DASHBOARD_SHEET_NAME = 'Dashboard Moderno'
const DASHBOARD_HISTORY_SHEET_NAME = 'Hist Regua Semanal Q3 2026'
const DASHBOARD_DATA_LAST_ROW = 20000
const SHEET_CLIENT_COLUMN_INDEX = 9
const SHEET_TOTAL_VALUE_COLUMN_INDEX = 11
const TARGET_START_COLUMN_INDEX = 1 // A
const TARGET_END_COLUMN_INDEX = 32 // AF
const DEFAULT_VALUE_SOURCE_SHEET_NAME = 'Clientes(V1)'
const MONTH_NAMES = [
  'JANEIRO',
  'FEVEREIRO',
  'MARÇO',
  'ABRIL',
  'MAIO',
  'JUNHO',
  'JULHO',
  'AGOSTO',
  'SETEMBRO',
  'OUTUBRO',
  'NOVEMBRO',
  'DEZEMBRO',
]
const REGUA_OPTIONS = [
  'Aviso de Inadimplência',
  'Lembrete de Atraso',
  'Negociação',
  'Rescisão',
  'Notificação',
  'PENDENTE',
  'Execução',
  'Pago',
  'Renegociado',
]
const REGUA_MATCHERS: Array<{ value: string; terms: string[] }> = [
  { value: 'Aviso de Inadimplência', terms: ['aviso de inadimplencia'] },
  { value: 'Lembrete de Atraso', terms: ['lembrete de atraso'] },
  { value: 'Negociação', terms: ['negociacao'] },
  { value: 'Rescisão', terms: ['rescisao'] },
  { value: 'Notificação', terms: ['notificacao'] },
  { value: 'PENDENTE', terms: ['pendente'] },
  { value: 'Execução', terms: ['execucao'] },
  { value: 'Pago', terms: ['pago', 'quitado'] },
  { value: 'Renegociado', terms: ['renegociado', 'renegociacao'] },
]
const STATUS_OPTIONS = ['ATIVO', 'INATIVO', '-']
const STATUS_COLORS = [
  { value: 'ATIVO', background: '#d9ead3', foreground: '#188038' },
  { value: 'INATIVO', background: '#f4cccc', foreground: '#cc0000' },
  { value: '-', background: '#cfe2f3', foreground: '#3d85c6' },
]
const REGUA_COLORS = [
  { value: 'Aviso de Inadimplência', background: '#cfe2f3', foreground: '#1155cc' },
  { value: 'Lembrete de Atraso', background: '#ead1f2', foreground: '#674ea7' },
  { value: 'Negociação', background: '#d9ead3', foreground: '#188038' },
  { value: 'Rescisão', background: '#d9d9d9', foreground: '#666666' },
  { value: 'Notificação', background: '#f4cccc', foreground: '#cc0000' },
  { value: 'PENDENTE', background: '#cc0000', foreground: '#ffffff', bold: true },
  { value: 'Execução', background: '#76a5af', foreground: '#073763' },
  { value: 'Pago', background: '#0b8043', foreground: '#ffffff', bold: true },
  { value: 'Renegociado', background: '#ffe599', foreground: '#7f6000' },
]
const TRELLO_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000
const trelloLookupCache = new Map<string, { expiresAt: number; promise: Promise<TrelloLookupResult> }>()

type SheetCellValue = string | number | null
type SheetValues = SheetCellValue[][]
type AutomationBody = {
  dryRun?: boolean
  maintenanceAction?: 'normalize_months' | 'repair_dashboard'
  normalizeLayout?: boolean
  maxRows?: number
  startRow?: number
  sheetName?: string
  pdfFileName?: string
  pdfRecords?: PdfRecord[]
  clearLog?: boolean
  allowFallbackSelections?: boolean
  selectedProcessMatches?: Record<string, SelectedProcessMatchInput> | Array<SelectedProcessMatchObjectInput & { recordKey: string }>
}

type SelectedProcessMatchObjectInput = {
  selectionId?: unknown
  totalAmount?: unknown
  amount?: unknown
  dueDate?: unknown
  description?: unknown
  openAmount?: unknown
  paidAmount?: unknown
  upcomingAmount?: unknown
}

type SelectedProcessMatchInput = SelectedProcessMatchObjectInput | string

type SelectedProcessMatch = {
  selectionId: string
  totalAmount: number | null
  amount: number | null
  dueDate: string
  description: string
  openAmount: number | null
  paidAmount: number | null
  upcomingAmount: number | null
  hasManualAmounts: boolean
  hasManualAdjustment: boolean
}

type PdfRecord = {
  name: string
  dueDate?: string
  amount?: number
  description?: string
  status?: string
  financialStatus?: string
  email?: string
}

type PreparedPdfRecord = PdfRecord & {
  normalizedName: string
  matchStem: string
  truncated: boolean
  recordKey: string
  entryFirstPairKey?: string
}

type TrelloCard = {
  id?: string
  name?: string
  desc?: string
  idList?: string
  shortUrl?: string
  url?: string
  due?: string | null
  dateLastActivity?: string
  labels?: Array<{ name?: string }>
  actions?: Array<{
    type?: string
    date?: string
    data?: { text?: string }
  }>
  closed?: boolean
}

type TrelloLookupResult = {
  found: boolean
  resultLabel: string
  situation: string
  statusLabel: string
  actionDate: string
  cardUrl: string
  error?: string
}

type IntegraLookupResult = {
  found: boolean
  status: string
  dueDate: string
  amount: number | null
  openAmount: number | null
  paidAmount: number | null
  upcomingAmount: number | null
  description: string
  error?: string
}

type SheetClientRow = {
  rowNumber: number
  clientName: string
  normalizedName: string
  values: SheetCellValue[]
}

type ColumnRole =
  | 'sourceCode'
  | 'fillDate'
  | 'dueDate'
  | 'amount'
  | 'description'
  | 'financialStatus'
  | 'recordStatus'
  | 'openAmount'
  | 'paidAmount'
  | 'upcomingAmount'
  | 'daysOverdue'
  | 'stageName'
  | 'trelloActionDate'
  | 'stageDays'
  | 'updatedAt'

type TargetColumn = {
  index: number
  header: string
  normalizedHeader: string
  role: ColumnRole | null
}

type AutomationLogEntry = {
  timestamp: string
  rowNumber: number | null
  clientName: string
  status: string
  action: string
  sources: string[]
  errorMessage: string
  details: string
  cardUrl: string
}

type AutomationPreviewRow = {
  rowNumber: number | null
  clientName: string
  action: string
  status: string
  sources: string[]
  errorMessage: string
  cardUrl: string
}

type AutomationDashboardMetric = {
  label: string
  value: number
}

type AutomationDashboard = {
  created: number
  updated: number
  refreshed: number
  pending: number
  notFound: number
  errors: number
  matched: number
  processed: number
  financial: {
    openAmount: number
    paidAmount: number
    upcomingAmount: number
  }
  stageBreakdown: AutomationDashboardMetric[]
  recordStatusBreakdown: AutomationDashboardMetric[]
  actionBreakdown: AutomationDashboardMetric[]
}

type ProcessOption = {
  selectionId: string
  rowNumber: number
  clientName: string
  code: string
  serviceCode: string
  process: string
  matter: string
  amount: number | null
  dueDay: string
  status: string
  financialStatus: string
  contractDate: string
}

type PendingProcessSelection = {
  recordKey: string
  clientName: string
  pdfDueDate: string
  pdfAmount: number | null
  pdfDescription: string
  suggestedSelectionId: string
  reason?: string
  options: ProcessOption[]
}

type AutomationResult = {
  dryRun: boolean
  sheetName: string
  pdfFileName: string
  timestamp: string
  startRow: number
  processed: number
  skipped: number
  matched: number
  updated: number
  refreshed: number
  ignored: number
  notFound: number
  errors: number
  updatedCells: number
  logRows: number
  preview: AutomationPreviewRow[]
  pendingCount: number
  pendingSelections: PendingProcessSelection[]
  dashboard: AutomationDashboard
}

type LogDashboardSummary = {
  timestamp: string
  dryRun: boolean
  sheetName: string
  pdfFileName: string
  processed: number
  skipped: number
  matched: number
  updated: number
  refreshed: number
  notFound: number
  errors: number
  logRows: number
  writeStatus: string
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeHeader(value: unknown) {
  return String(value || '')
    .replace(/\n/g, ' ')
    .trim()
    .split(/\s+/)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

function normalizeLooseText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeClientName(value: unknown) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*.*/, '')
    .replace(/\s*(?:\.{3}|…)\s*$/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function resolveReguaOption(...values: Array<unknown>) {
  const normalizedValues = values
    .map((value) => normalizeLooseText(value))
    .filter(Boolean)

  for (const matcher of REGUA_MATCHERS) {
    if (normalizedValues.some((value) => matcher.terms.some((term) => value.includes(term)))) {
      return matcher.value
    }
  }

  return ''
}

function resolveStatusOption(...values: Array<unknown>) {
  const normalizedValues = values
    .map((value) => normalizeLooseText(value))
    .filter(Boolean)

  if (normalizedValues.some((value) => value.includes('inativa') || value.includes('inativo'))) {
    return 'INATIVO'
  }

  return 'ATIVO'
}

function isInvalidPdfClientName(value: unknown) {
  const normalized = normalizeLooseText(value)
  if (!normalized) return true
  if (normalized.startsWith('descricao')) return true
  if (normalized.includes('valor') && normalized.includes('parcela')) return true
  if (normalized.includes('atuacao extrajudicial')) return true
  if (normalized.includes('interposicao de recurso')) return true
  return false
}

function isTruncatedClientName(value: unknown) {
  return /\s*(?:\.{3}|…)\s*$/.test(String(value || ''))
}

function canMatchTruncatedName(sheetName: string, pdfStem: string) {
  if (!sheetName || !pdfStem) return false
  if (!sheetName.startsWith(pdfStem)) return false

  const tokens = pdfStem.split(' ').filter(Boolean)
  if (tokens.length < 3) return false

  const joinedLength = tokens.join('').length
  if (joinedLength < 10) return false

  const lastToken = tokens[tokens.length - 1] || ''
  return lastToken.length >= 2
}

function canMatchShortenedName(leftName: string, rightName: string) {
  if (!leftName || !rightName) return false

  const [shorter, longer] =
    leftName.length <= rightName.length ? [leftName, rightName] : [rightName, leftName]

  if (!longer.startsWith(shorter)) return false

  const tokens = shorter.split(' ').filter(Boolean)
  if (tokens.length < 3) return false

  const lastToken = tokens[tokens.length - 1] || ''
  if (['de', 'da', 'do', 'dos', 'das', 'e'].includes(lastToken)) return false

  const joinedLength = tokens.join('').length
  if (joinedLength < 10) return false

  return lastToken.length >= 3
}

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replaceAll("'", "''")}'`
}

function columnLetter(indexOneBased: number) {
  let index = indexOneBased
  let letter = ''
  while (index > 0) {
    const remainder = (index - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    index = Math.floor((index - 1) / 26)
  }
  return letter
}

function hexToGoogleColor(hex: string) {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  if (!Number.isFinite(value)) return { red: 1, green: 1, blue: 1 }

  return {
    red: ((value >> 16) & 255) / 255,
    green: ((value >> 8) & 255) / 255,
    blue: (value & 255) / 255,
  }
}

function buildTextEqualsFormatRule(
  sheetId: number,
  columnIndexOneBased: number,
  value: string,
  background: string,
  foreground: string,
  bold = false,
) {
  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: columnIndexOneBased - 1,
            endColumnIndex: columnIndexOneBased,
          },
        ],
        booleanRule: {
          condition: {
            type: 'TEXT_EQ',
            values: [{ userEnteredValue: value }],
          },
          format: {
            backgroundColor: hexToGoogleColor(background),
            textFormat: {
              foregroundColor: hexToGoogleColor(foreground),
              bold,
            },
          },
        },
      },
      index: 0,
    },
  }
}

function getCell(row: Array<unknown>, columnIndexOneBased: number) {
  return String(row[columnIndexOneBased - 1] || '').trim()
}

function setIfMissing<T extends string>(set: Set<T>, value: T | null | undefined) {
  if (value) set.add(value)
}

function parseAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value

  const normalized = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

function formatCurrency(value: number | null) {
  if (value === null || !Number.isFinite(value)) return ''
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function sheetNumber(value: number | null) {
  return value !== null && Number.isFinite(value) ? value : ''
}

function normalizeDate(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return ''

  const brMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/)
  if (brMatch) {
    const [, day, month, year] = brMatch
    const fullYear = year.length === 2 ? `20${year}` : year
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${fullYear}`
  }

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`
  }

  return text
}

function parseBrDate(value: string) {
  const match = normalizeDate(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null

  const [, day, month, year] = match
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatBrDate(date: Date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear())
  return `${day}/${month}/${year}`
}

function diffDaysFromToday(value: string) {
  const date = parseBrDate(value)
  if (!date) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)

  return Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))
}

function isMonthSeparator(value: string) {
  const normalized = normalizeHeader(value)
  return MONTH_NAMES.some((month) => normalized === normalizeHeader(month))
}

function resolveMonthName(value: string) {
  const normalized = normalizeHeader(value)
  const monthByName = MONTH_NAMES.find((month) => normalizeHeader(month) === normalized)
  if (monthByName) return monthByName

  const date = parseBrDate(value)
  if (!date) return ''
  return MONTH_NAMES[date.getMonth()] || ''
}

function findLastVisibleMonth(values: SheetValues) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const row = values[index] || []
    for (const cell of row) {
      const text = String(cell || '').trim()
      const monthName = isMonthSeparator(text) ? resolveMonthName(text) : ''
      if (monthName) return monthName
    }

    const dataMonthName = resolveMonthName(getCell(row, 1))
    if (dataMonthName) return dataMonthName
  }

  return ''
}

function normalizeStatus(value: string) {
  const normalized = normalizeHeader(value)
  if (!normalized) return ''
  if (normalized.includes('QUITADO') || normalized.includes('PAGO')) return 'QUITADO'
  if (normalized.includes('ATRAS')) return 'EM ATRASO'
  if (normalized.includes('VENCER')) return 'A VENCER'
  if (normalized.includes('DIA')) return 'EM DIA'
  return value.trim().toUpperCase()
}

function compareValue(value: string) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function pickObject(payload: unknown): Record<string, unknown> | null {
  if (!payload) return null
  if (Array.isArray(payload)) {
    return (payload.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined) || null
  }
  if (typeof payload !== 'object') return null

  const objectPayload = payload as Record<string, unknown>
  const nestedKeys = ['data', 'result', 'results', 'items', 'records', 'clientes', 'clients']
  for (const key of nestedKeys) {
    const nested = objectPayload[key]
    if (Array.isArray(nested)) {
      const first = nested.find((item) => item && typeof item === 'object')
      if (first && typeof first === 'object') return first as Record<string, unknown>
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>
    }
  }

  return objectPayload
}

function pickField(record: Record<string, unknown> | null, aliases: string[]) {
  if (!record) return undefined

  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias))
  for (const [key, value] of Object.entries(record)) {
    if (normalizedAliases.includes(normalizeHeader(key))) return value
  }
  return undefined
}

function resolveColumnRole(header: string): ColumnRole | null {
  const normalized = normalizeHeader(header)
  if (!normalized) return null

  if (['COD_CL', 'CODIGO_CLIENTE', 'CODIGO_DO_CLIENTE'].includes(normalized)) return 'sourceCode'
  if (normalized === 'DATA') return 'fillDate'
  if (['VENCIMENTO', 'DATA_DE_VENCIMENTO', 'DT_VENCIMENTO'].includes(normalized)) return 'dueDate'
  if (['VALOR', 'VALOR_TOTAL', 'TOTAL'].includes(normalized)) return 'amount'
  if (['DESCRICAO', 'DESCRICAO_DA_PARCELA', 'PARCELA'].includes(normalized)) return 'description'
  if (['FINANCEIRO', 'STATUS_FINANCEIRO'].includes(normalized)) return 'financialStatus'
  if (normalized === 'STATUS') return 'recordStatus'
  if (['VALOR_EM_ABERTO', 'ABERTO', 'SALDO_ABERTO'].includes(normalized)) return 'openAmount'
  if (['VALOR_PAGO', 'PAGO'].includes(normalized)) return 'paidAmount'
  if (['VALOR_A_VENCER', 'A_VENCER'].includes(normalized)) return 'upcomingAmount'
  if (['DIAS_VENCIDOS', 'DIAS_EM_ATRASO', 'DIAS_VENCIDO'].includes(normalized)) return 'daysOverdue'
  if (['REGUA', 'SITUACAO_DA_COBRANCA', 'SITUACAO', 'SITUACAO_TRELLO'].includes(normalized)) return 'stageName'
  if (['DATA_DA_ACAO', 'DATA_ACAO', 'ULTIMA_ACAO'].includes(normalized)) return 'trelloActionDate'
  if (['DIAS_NA_FASE'].includes(normalized)) return 'stageDays'
  if (['DATA_DA_ATUALIZACAO', 'DATA_ATUALIZACAO', 'ATUALIZACAO', 'ULTIMA_ATUALIZACAO'].includes(normalized)) return 'updatedAt'

  return null
}

function describeTargetColumns(headers: string[]) {
  const columns: TargetColumn[] = []
  for (let index = TARGET_START_COLUMN_INDEX; index <= TARGET_END_COLUMN_INDEX; index += 1) {
    const header = String(headers[index - 1] || '').trim()
    columns.push({
      index,
      header,
      normalizedHeader: normalizeHeader(header),
      role: resolveColumnRole(header),
    })
  }
  return columns
}

function buildSheetClientRows(values: SheetValues, startRow: number, maxRows: number) {
  const rows: SheetClientRow[] = []
  let skipped = 0

  for (let index = startRow - 1; index < values.length; index += 1) {
    const row = values[index] || []
    const clientName = getCell(row, SHEET_CLIENT_COLUMN_INDEX)
    if (!clientName || isMonthSeparator(clientName)) {
      skipped += 1
      continue
    }

    rows.push({
      rowNumber: index + 1,
      clientName,
      normalizedName: normalizeClientName(clientName),
      values: row,
    })

    if (maxRows > 0 && rows.length >= maxRows) break
  }

  return { rows, skipped }
}

function findLastFilledRow(values: SheetValues) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const row = values[index] || []
    const hasContent = row.some((cell) => String(cell || '').trim() !== '')
    if (hasContent) {
      return index + 1
    }
  }

  return 1
}

function getYearMonthKey(value: string) {
  const date = parseBrDate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function compareYearMonth(left: string, right: string) {
  return left.localeCompare(right)
}

function findMonthInsertionBase(values: SheetValues, sourceDate: string) {
  const targetKey = getYearMonthKey(sourceDate)
  const monthName = resolveMonthName(sourceDate)
  const lastFilledRow = findLastFilledRow(values)
  if (!targetKey || !monthName) {
    return { rowNumber: lastFilledRow + 1, monthName, needsSeparator: false }
  }

  let lastSameMonthRow = 0
  let firstLaterMonthRow = 0

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] || []
    const rowKey = getYearMonthKey(getCell(row, 1))
    if (!rowKey) continue

    if (rowKey === targetKey) {
      lastSameMonthRow = index + 1
      continue
    }

    if (!firstLaterMonthRow && compareYearMonth(rowKey, targetKey) > 0) {
      const previousRow = values[index - 1] || []
      const previousRowHasMonthSeparator = previousRow.some((cell) => isMonthSeparator(String(cell || '').trim()))
      firstLaterMonthRow = previousRowHasMonthSeparator ? index : index + 1
    }
  }

  if (lastSameMonthRow) {
    return { rowNumber: lastSameMonthRow + 1, monthName, needsSeparator: false }
  }

  return {
    rowNumber: firstLaterMonthRow || lastFilledRow + 1,
    monthName,
    needsSeparator: true,
  }
}

function shiftA1Rows(range: string, startRow: number, delta: number) {
  return range.replace(/([A-Z]+)(\d+)/g, (match, column, rowText) => {
    const rowNumber = Number(rowText)
    if (!Number.isFinite(rowNumber) || rowNumber < startRow) return match
    return `${column}${rowNumber + delta}`
  })
}

function normalizeSheetRowLength(row: string[], width = TARGET_END_COLUMN_INDEX) {
  const normalized = row.slice(0, width)
  while (normalized.length < width) {
    normalized.push('')
  }
  return normalized
}

function normalizeAmountZeroCells(row: string[]) {
  if (!isClientDataRow(row)) return row

  for (const columnIndex of [21, 22, 23]) {
    const currentValue = getCell(row, columnIndex)
    if (!currentValue) {
      row[columnIndex - 1] = 0
    }
  }

  return row
}

function isClientDataRow(row: string[]) {
  const clientName = getCell(row, SHEET_CLIENT_COLUMN_INDEX)
  if (!clientName) return false
  return !row.some((cell) => isMonthSeparator(String(cell || '').trim()))
}

function nonEmptyCellCount(row: string[]) {
  return row.filter((cell) => String(cell || '').trim()).length
}

function getDeduplicationKey(row: string[]) {
  const normalizedName = normalizeClientName(getCell(row, SHEET_CLIENT_COLUMN_INDEX))
  if (!normalizedName) return ''

  const totalAmount = parseAmount(getCell(row, SHEET_TOTAL_VALUE_COLUMN_INDEX))
  if (totalAmount === null || totalAmount <= 0) return ''

  const amountKey = amountPairKey(totalAmount)
  return `${normalizedName}__${amountKey}`
}

function canMergeDuplicateClientRows(rows: SheetCellValue[][]) {
  const sourceCodes = new Set(rows.map((row) => normalizeHeader(getCell(row, 5))).filter(Boolean))
  return sourceCodes.size <= 1
}

function choosePreferredDuplicateRow(rows: string[][]) {
  return rows
    .map((row) => ({
      row,
      openAmount: parseAmount(getCell(row, 21)) || 0,
      paidAmount: parseAmount(getCell(row, 22)) || 0,
      upcomingAmount: parseAmount(getCell(row, 23)) || 0,
      date: parseBrDate(getCell(row, 1)),
      filled: nonEmptyCellCount(row),
    }))
    .sort((left, right) => {
      const leftHasCode = getCell(left.row, 5) ? 1 : 0
      const rightHasCode = getCell(right.row, 5) ? 1 : 0
      const leftOpen = left.openAmount > 0 ? 1 : 0
      const rightOpen = right.openAmount > 0 ? 1 : 0

      return (
        rightHasCode - leftHasCode ||
        rightOpen - leftOpen ||
        right.paidAmount - left.paidAmount ||
        right.openAmount - left.openAmount ||
        right.upcomingAmount - left.upcomingAmount ||
        right.filled - left.filled ||
        (left.date?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.date?.getTime() ?? Number.MAX_SAFE_INTEGER)
      )
    })[0]?.row || rows[0]
}

function mergeDuplicateClientRows(rows: SheetCellValue[][]) {
  const merged = [...choosePreferredDuplicateRow(rows)]
  const dates = rows.map((row) => parseBrDate(getCell(row, 1))).filter((date): date is Date => Boolean(date))
  const earliestDate = dates.sort((left, right) => left.getTime() - right.getTime())[0]
  if (earliestDate) {
    merged[0] = formatBrDate(earliestDate)
  }

  for (let index = 0; index < merged.length; index += 1) {
    if (String(merged[index] || '').trim()) continue

    const fallbackValue = rows
      .map((row) => getCell(row, index + 1))
      .find((value) => String(value || '').trim())
    if (fallbackValue) {
      merged[index] = fallbackValue
    }
  }

  const totalAmount = rows
    .map((row) => parseAmount(getCell(row, SHEET_TOTAL_VALUE_COLUMN_INDEX)))
    .find((amount): amount is number => amount !== null && amount > 0) ?? null
  const openAmount = Math.max(...rows.map((row) => parseAmount(getCell(row, 21)) || 0))
  const paidAmount = Math.max(...rows.map((row) => parseAmount(getCell(row, 22)) || 0))
  const upcomingAmount = totalAmount !== null ? Math.max(totalAmount - openAmount - paidAmount, 0) : Math.max(...rows.map((row) => parseAmount(getCell(row, 23)) || 0))
  const dueDateRow = rows
    .map((row) => ({
      row,
      openAmount: parseAmount(getCell(row, 21)) || 0,
      overdueDays: Number(getCell(row, 25)) || 0,
    }))
    .sort((left, right) => right.openAmount - left.openAmount || right.overdueDays - left.overdueDays)[0]?.row

  if (totalAmount !== null) merged[SHEET_TOTAL_VALUE_COLUMN_INDEX - 1] = sheetNumber(totalAmount)
  merged[14] = openAmount > 0 ? 'EM ATRASO' : upcomingAmount > 0 ? 'A VENCER' : paidAmount > 0 ? 'QUITADO' : ''
  merged[17] = getCell(dueDateRow || merged, 18)
  merged[20] = sheetNumber(openAmount)
  merged[21] = sheetNumber(paidAmount)
  merged[22] = sheetNumber(upcomingAmount)
  merged[24] = getCell(dueDateRow || merged, 25)

  return merged
}

function buildSortedMonthlySheetLayout(values: SheetValues, width = TARGET_END_COLUMN_INDEX) {
  const lastFilledRow = findLastFilledRow(values)
  const rawDataRows = values
    .slice(1, lastFilledRow)
    .map((row, index) => ({
      originalRowNumber: index + 2,
      row: normalizeAmountZeroCells(normalizeSheetRowLength(row || [], width)),
      date: parseBrDate(getCell(row || [], 1)),
    }))
    .filter((item) => isClientDataRow(item.row))

  const deduplicationBuckets = new Map<string, typeof rawDataRows>()
  const uniqueDataRows: typeof rawDataRows = []
  for (const item of rawDataRows) {
    const key = getDeduplicationKey(item.row)
    if (!key) {
      uniqueDataRows.push(item)
      continue
    }

    const bucket = deduplicationBuckets.get(key) || []
    bucket.push(item)
    deduplicationBuckets.set(key, bucket)
  }

  for (const bucket of deduplicationBuckets.values()) {
    if (bucket.length === 1 || !canMergeDuplicateClientRows(bucket.map((item) => item.row))) {
      uniqueDataRows.push(...bucket)
      continue
    }

    const mergedRow = mergeDuplicateClientRows(bucket.map((item) => item.row))
    const earliestOriginalRowNumber = Math.min(...bucket.map((item) => item.originalRowNumber))
    uniqueDataRows.push({
      originalRowNumber: earliestOriginalRowNumber,
      row: normalizeAmountZeroCells(normalizeSheetRowLength(mergedRow, width)),
      date: parseBrDate(getCell(mergedRow, 1)),
    })
  }

  const dataRows = uniqueDataRows
  dataRows.sort((left, right) => {
    const leftTime = left.date?.getTime() ?? Number.MAX_SAFE_INTEGER
    const rightTime = right.date?.getTime() ?? Number.MAX_SAFE_INTEGER
    return leftTime - rightTime || left.originalRowNumber - right.originalRowNumber
  })

  const sortedRows: SheetValues = []
  const separatorRows: number[] = []
  const rowNumberByOriginalRow = new Map<number, number>()
  let currentMonth = ''

  for (const item of dataRows) {
    const monthName = resolveMonthName(getCell(item.row, 1))
    if (monthName && monthName !== currentMonth) {
      sortedRows.push(createMonthSeparatorRow(monthName, width))
      separatorRows.push(sortedRows.length + 1)
      currentMonth = monthName
    }

    sortedRows.push(item.row)
    rowNumberByOriginalRow.set(item.originalRowNumber, sortedRows.length + 1)
  }

  const writableRowCount = Math.max(lastFilledRow - 1, sortedRows.length)
  while (sortedRows.length < writableRowCount) {
    sortedRows.push(Array.from({ length: width }, () => ''))
  }

  return {
    values: sortedRows,
    separatorRows,
    rowNumberByOriginalRow,
    lastRowNumber: writableRowCount + 1,
  }
}

type SheetAmountEntry = {
  selectionId: string
  rowNumber: number
  clientName: string
  normalizedName: string
  code: string
  serviceCode: string
  process: string
  matter: string
  amount: number
  date: string
  dueDay: string
  status: string
  financialStatus: string
}

function buildSheetAmountLookup(rows: SheetClientRow[]) {
  const exactLookup = new Map<string, SheetAmountEntry[]>()
  const entries: SheetAmountEntry[] = []

  for (const row of rows) {
    const amount = parseAmount(getCell(row.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
    const date = normalizeDate(getCell(row.values, 1))
    const code = getCell(row.values, 5)
    const serviceCode = getCell(row.values, 7)
    const matter = getCell(row.values, 10)
    const process = getCell(row.values, 12)
    const dueDay = getCell(row.values, 13)
    const status = getCell(row.values, 14)
    const financialStatus = getCell(row.values, 15)
    if (amount === null && !date && !code) continue

    const entry = {
      selectionId: String(row.rowNumber),
      rowNumber: row.rowNumber,
      clientName: row.clientName,
      normalizedName: row.normalizedName,
      code,
      serviceCode,
      process,
      matter,
      amount: amount ?? 0,
      date,
      dueDay,
      status,
      financialStatus,
    }

    const bucket = exactLookup.get(row.normalizedName) || []
    bucket.push(entry)
    exactLookup.set(row.normalizedName, bucket)
    entries.push(entry)
  }

  return { exactLookup, entries }
}

function resolveSourceCandidatesForClient(
  lookup: ReturnType<typeof buildSheetAmountLookup>,
  normalizedClientName: string,
) {
  const exact = lookup.exactLookup.get(normalizedClientName)
  if (exact && exact.length > 0) return exact

  return lookup.entries.filter((entry) =>
    canMatchTruncatedName(entry.normalizedName, normalizedClientName) ||
    canMatchTruncatedName(normalizedClientName, entry.normalizedName) ||
    canMatchShortenedName(entry.normalizedName, normalizedClientName),
  )
}

function scoreFallbackSourceCandidate(entry: SheetAmountEntry, normalizedClientName: string) {
  const sourceTokens = new Set(entry.normalizedName.split(' ').filter(Boolean))
  const targetTokens = normalizedClientName.split(' ').filter(Boolean)
  const sharedTokens = targetTokens.filter((token) => sourceTokens.has(token))
  if (sharedTokens.length < 2) return 0

  const lastTargetToken = targetTokens[targetTokens.length - 1] || ''
  const lastSourceToken = entry.normalizedName.split(' ').filter(Boolean).slice(-1)[0] || ''

  let score = sharedTokens.length * 12
  if (lastTargetToken && lastSourceToken && lastTargetToken === lastSourceToken) {
    score += 30
  }

  if (
    sharedTokens.length === 1 &&
    sharedTokens[0] &&
    sharedTokens[0].length < 5 &&
    lastTargetToken !== sharedTokens[0]
  ) {
    score -= 15
  }

  return score
}

function resolveFallbackSourceCandidates(
  lookup: ReturnType<typeof buildSheetAmountLookup>,
  normalizedClientName: string,
) {
  return lookup.entries
    .map((entry) => ({
      entry,
      score: scoreFallbackSourceCandidate(entry, normalizedClientName),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.rowNumber - right.entry.rowNumber)
    .slice(0, 6)
    .map((item) => item.entry)
}

async function loadValueSourceRows(
  accessToken: string,
  currentSpreadsheetId: string,
  currentSheetName: string,
  currentValues: SheetValues,
) {
  const sourceSpreadsheetId = Deno.env.get('GOOGLE_VALUE_SOURCE_SPREADSHEET_ID') || currentSpreadsheetId
  const sourceSheetName = Deno.env.get('GOOGLE_VALUE_SOURCE_SHEET_NAME') || DEFAULT_VALUE_SOURCE_SHEET_NAME

  const sourceService =
    sourceSpreadsheetId === currentSpreadsheetId
      ? null
      : new GoogleSheetsService(sourceSpreadsheetId, accessToken)

  const sourceValues =
    !sourceService && currentSheetName === sourceSheetName
      ? currentValues
      : await (sourceService || new GoogleSheetsService(currentSpreadsheetId, accessToken)).readSheetValues(sourceSheetName)

  const { rows } = buildSheetClientRows(sourceValues, 2, 0)
  return buildSheetAmountLookup(rows)
}

function buildPdfRecordIndex(pdfRecords: PdfRecord[]) {
  const records: PreparedPdfRecord[] = []
  const exactLookup = new Map<string, PreparedPdfRecord[]>()

  for (const [index, record] of pdfRecords.entries()) {
    if (isInvalidPdfClientName(record.name)) continue
    const normalizedName = normalizeClientName(record.name)
    if (!normalizedName) continue

    const preparedRecord: PreparedPdfRecord = {
      ...record,
      normalizedName,
      matchStem: normalizedName,
      truncated: isTruncatedClientName(record.name),
      recordKey: `${normalizedName}__${index}`,
      dueDate: normalizeDate(record.dueDate),
      amount: typeof record.amount === 'number' && Number.isFinite(record.amount) ? record.amount : undefined,
      description: String(record.description || '').trim(),
    }

    records.push(preparedRecord)

    const bucket = exactLookup.get(normalizedName) || []
    bucket.push(preparedRecord)
    exactLookup.set(normalizedName, bucket)
  }

  const possibleEntryFirstPairs = new Map<string, PreparedPdfRecord[]>()
  for (const record of records) {
    if (!isEntryOrFirstInstallment(record.description || '')) continue
    const amountKey = amountPairKey(record.amount)
    if (!amountKey) continue
    const key = `${record.normalizedName}__${amountKey}`
    const bucket = possibleEntryFirstPairs.get(key) || []
    bucket.push(record)
    possibleEntryFirstPairs.set(key, bucket)
  }

  for (const [key, bucket] of possibleEntryFirstPairs.entries()) {
    const hasEntry = bucket.some((record) => isEntryDescription(record.description || ''))
    const hasFirstInstallment = bucket.some((record) => isFirstInstallmentDescription(record.description || ''))
    if (!hasEntry || !hasFirstInstallment) continue

    for (const record of bucket) {
      record.entryFirstPairKey = key
    }
  }

  return { records, exactLookup }
}

function normalizeSelectedProcessMatches(
  value: AutomationBody['selectedProcessMatches'],
) {
  const result = new Map<string, SelectedProcessMatch>()

  const parseOptionalAmount = (input: unknown) => {
    if (typeof input === 'number') return Number.isFinite(input) ? input : null
    if (!String(input ?? '').trim()) return null
    return parseAmount(input)
  }

  const normalizeMatch = (input: SelectedProcessMatchInput): SelectedProcessMatch | null => {
    if (typeof input === 'string') {
      return {
        selectionId: input,
        totalAmount: null,
        amount: null,
        dueDate: '',
        description: '',
        openAmount: null,
        paidAmount: null,
        upcomingAmount: null,
        hasManualAmounts: false,
        hasManualAdjustment: false,
      }
    }

    if (!input || typeof input !== 'object') return null

    const selectionId = typeof input.selectionId === 'string' ? input.selectionId : ''
    const openAmount = parseOptionalAmount(input.openAmount)
    const paidAmount = parseOptionalAmount(input.paidAmount)
    const upcomingAmount = parseOptionalAmount(input.upcomingAmount)
    const totalAmount = parseOptionalAmount(input.totalAmount)
    const amount = parseOptionalAmount(input.amount)
    const dueDate = normalizeDate(input.dueDate)
    const description = typeof input.description === 'string' ? input.description.trim() : ''
    const hasManualAmounts = openAmount !== null || paidAmount !== null || upcomingAmount !== null
    const hasManualAdjustment = hasManualAmounts || totalAmount !== null || amount !== null || Boolean(dueDate || description)

    if (!selectionId && !hasManualAdjustment) return null

    return {
      selectionId,
      totalAmount,
      amount,
      dueDate,
      description,
      openAmount,
      paidAmount,
      upcomingAmount,
      hasManualAmounts,
      hasManualAdjustment,
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && typeof item.recordKey === 'string') {
        const match = normalizeMatch(item)
        if (match) result.set(item.recordKey, match)
      }
    }
    return result
  }

  if (value && typeof value === 'object') {
    for (const [recordKey, input] of Object.entries(value)) {
      const match = normalizeMatch(input)
      if (match) result.set(recordKey, match)
    }
  }

  return result
}

function parseInstallmentNumber(description: string) {
  const match = String(description || '').match(/(\d{1,3})\s*(?:a|ª|o|º)?\s*parcela/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function amountPairKey(amount: number | null | undefined) {
  return typeof amount === 'number' && Number.isFinite(amount) ? String(Math.round(amount * 100)) : ''
}

function amountsMatch(left: number | null | undefined, right: number | null | undefined) {
  const leftKey = amountPairKey(left)
  const rightKey = amountPairKey(right)
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

function isEntryDescription(description: string) {
  const normalized = normalizeHeader(description)
  return normalized === 'ENTRADA' || normalized.startsWith('ENTRADA_')
}

function isFirstInstallmentDescription(description: string) {
  return parseInstallmentNumber(description) === 1
}

function isEntryOrFirstInstallment(description: string) {
  return isEntryDescription(description) || isFirstInstallmentDescription(description)
}

function buildProcessOption(entry: SheetAmountEntry): ProcessOption {
  return {
    selectionId: entry.selectionId,
    rowNumber: entry.rowNumber,
    clientName: entry.clientName,
    code: entry.code,
    serviceCode: entry.serviceCode,
    process: entry.process,
    matter: entry.matter,
    amount: Number.isFinite(entry.amount) ? entry.amount : null,
    dueDay: entry.dueDay,
    status: entry.status,
    financialStatus: entry.financialStatus,
    contractDate: entry.date,
  }
}

function isClosedOrPaidProcess(...values: Array<unknown>) {
  const normalizedValues = values
    .map((value) => normalizeLooseText(value))
    .filter(Boolean)

  return normalizedValues.some(
    (value) =>
      value.includes('quitado') ||
      value.includes('a vista') ||
      value.includes('avista') ||
      value.includes('finalizado') ||
      value.includes('pago'),
  )
}

function getSelectableProcessCandidates(candidates: SheetAmountEntry[]) {
  const selectable = candidates.filter(
    (candidate) => !isClosedOrPaidProcess(candidate.status, candidate.financialStatus),
  )

  return selectable.length > 0 ? selectable : candidates
}

function isClosedOrPaidRecord(record: PreparedPdfRecord) {
  return isClosedOrPaidProcess(record.status, record.financialStatus)
}

function findStrictProcessCandidate(
  candidates: SheetAmountEntry[],
  pdfRecord: PreparedPdfRecord,
  currentCode: string,
) {
  if (currentCode) {
    const codeMatches = candidates.filter(
      (candidate) => candidate.code && normalizeHeader(candidate.code) === normalizeHeader(currentCode),
    )
    if (codeMatches.length === 1) return codeMatches[0]
  }

  const amountMatches = candidates.filter((candidate) => amountsMatch(candidate.amount, pdfRecord.amount))
  if (amountMatches.length === 1) return amountMatches[0]

  const dueDate = parseBrDate(pdfRecord.dueDate || '')
  if (dueDate && amountMatches.length > 1) {
    const dueDayMatches = amountMatches.filter((candidate) => Number(candidate.dueDay) === dueDate.getDate())
    if (dueDayMatches.length === 1) return dueDayMatches[0]
  }

  return null
}

function scoreProcessOption(
  option: ProcessOption,
  pdfRecord: PreparedPdfRecord,
  currentCode: string,
) {
  let score = 0

  if (currentCode && option.code && normalizeHeader(option.code) === normalizeHeader(currentCode)) {
    score += 100
  }

  const dueDay = Number(option.dueDay)
  const dueDate = parseBrDate(pdfRecord.dueDate || '')
  if (dueDate && Number.isFinite(dueDay) && dueDay === dueDate.getDate()) {
    score += 40
  }

  if (typeof pdfRecord.amount === 'number' && Number.isFinite(option.amount) && option.amount !== null) {
    if (option.amount >= pdfRecord.amount) score += 10
    const delta = Math.abs(option.amount - pdfRecord.amount)
    if (delta <= 0.01) score += 15
    else if (delta <= pdfRecord.amount) score += 5
  }

  const installmentNumber = parseInstallmentNumber(pdfRecord.description || '')
  if (installmentNumber !== null && installmentNumber > 0 && option.amount && pdfRecord.amount) {
    const estimatedTotal = installmentNumber * pdfRecord.amount
    const delta = Math.abs(option.amount - estimatedTotal)
    if (delta <= pdfRecord.amount) score += 15
  }

  return score
}

function buildPendingProcessSelection(
  pdfRecord: PreparedPdfRecord,
  candidates: SheetAmountEntry[],
  currentCode: string,
  reason = '',
  allowSuggestion = true,
): PendingProcessSelection {
  const options = getSelectableProcessCandidates(candidates).map(buildProcessOption)
  const scored = options.map((option) => ({
    option,
    score: scoreProcessOption(option, pdfRecord, currentCode),
  }))

  scored.sort((left, right) => right.score - left.score || left.option.rowNumber - right.option.rowNumber)

  const suggestedSelectionId =
    allowSuggestion && scored.length > 0 && (scored.length === 1 || scored[0].score > scored[1].score) && scored[0].score > 0
      ? scored[0].option.selectionId
      : ''

  return {
    recordKey: pdfRecord.recordKey,
    clientName: pdfRecord.name,
    pdfDueDate: pdfRecord.dueDate || '',
    pdfAmount: typeof pdfRecord.amount === 'number' ? pdfRecord.amount : null,
    pdfDescription: String(pdfRecord.description || '').trim(),
    suggestedSelectionId,
    reason,
    options,
  }
}

function chooseBestCandidateByScore(
  candidates: SheetAmountEntry[],
  pdfRecord: PreparedPdfRecord,
  currentCode: string,
) {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreProcessOption(buildProcessOption(candidate), pdfRecord, currentCode),
    }))
    .sort((left, right) => right.score - left.score || left.candidate.rowNumber - right.candidate.rowNumber)

  if (scored.length === 0) return null
  if (scored.length === 1) return scored[0].candidate
  if (scored[0].score > scored[1].score) return scored[0].candidate

  return scored[0].candidate
}

function resolveSelectedSourceCandidate(
  candidates: SheetAmountEntry[],
  pdfRecord: PreparedPdfRecord,
  selectedSelectionId: string | undefined,
  currentCode: string,
) {
  const selectableCandidates = getSelectableProcessCandidates(candidates)
  if (selectableCandidates.length === 0) return null
  if (selectedSelectionId) {
    return selectableCandidates.find((candidate) => candidate.selectionId === selectedSelectionId) || null
  }
  if (selectableCandidates.length === 1 && candidates.length === 1) return selectableCandidates[0]
  if (isClosedOrPaidRecord(pdfRecord)) {
    return findStrictProcessCandidate(candidates, pdfRecord, currentCode)
  }

  if (currentCode) {
    const codeMatches = selectableCandidates.filter(
      (candidate) => candidate.code && normalizeHeader(candidate.code) === normalizeHeader(currentCode),
    )
    if (codeMatches.length === 1) return codeMatches[0]
  }

  const allCandidatesClosed = candidates.length > 0 && selectableCandidates.length === candidates.length && selectableCandidates.every(
    (candidate) => isClosedOrPaidProcess(candidate.status, candidate.financialStatus),
  )
  if (allCandidatesClosed) {
    return chooseBestCandidateByScore(selectableCandidates, pdfRecord, currentCode)
  }

  return null
}

function prepareSourceSelection(
  lookup: ReturnType<typeof buildSheetAmountLookup>,
  normalizedClientName: string,
  pdfRecord: PreparedPdfRecord,
  selectedSelectionId: string | undefined,
  currentCode: string,
  allowFallbackSelections: boolean,
) {
  const directCandidates = resolveSourceCandidatesForClient(lookup, normalizedClientName)
  if (directCandidates.length > 0) {
    return {
      sourceEntry: resolveSelectedSourceCandidate(directCandidates, pdfRecord, selectedSelectionId, currentCode),
      pendingSelection: null as PendingProcessSelection | null,
    }
  }

  if (allowFallbackSelections && selectedSelectionId) {
    const selectedFallback = lookup.entries.find((entry) => entry.selectionId === selectedSelectionId) || null
    if (selectedFallback) {
      return {
        sourceEntry: selectedFallback,
        pendingSelection: null as PendingProcessSelection | null,
      }
    }
  }

  const fallbackCandidates = resolveFallbackSourceCandidates(lookup, normalizedClientName)
  if (fallbackCandidates.length > 0) {
    return {
      sourceEntry: null,
      pendingSelection: buildPendingProcessSelection(
        pdfRecord,
        fallbackCandidates,
        currentCode,
        'Cliente não encontrado automaticamente na Prospecção (PRD). Selecione o processo correto antes de preencher.',
        false,
      ),
    }
  }

  return {
    sourceEntry: null,
    pendingSelection: null as PendingProcessSelection | null,
  }
}

function resolvePdfRecordForRow(
  row: SheetClientRow,
  pdfIndex: ReturnType<typeof buildPdfRecordIndex>,
  matchedRecordKeys: Set<string>,
) {
  const exactMatches = (pdfIndex.exactLookup.get(row.normalizedName) || []).filter(
    (record) => !matchedRecordKeys.has(record.recordKey),
  )
  if (exactMatches.length > 0) {
    return exactMatches[0]
  }

  const truncatedMatches = pdfIndex.records
    .filter((record) => !matchedRecordKeys.has(record.recordKey))
    .filter(
      (record) =>
        (record.truncated && canMatchTruncatedName(row.normalizedName, record.matchStem)) ||
        canMatchShortenedName(row.normalizedName, record.matchStem),
    )
    .sort((left, right) => right.matchStem.length - left.matchStem.length)

  if (truncatedMatches.length === 0) {
    return null
  }

  if (truncatedMatches.length === 1) {
    return truncatedMatches[0]
  }

  const [best, second] = truncatedMatches
  if (!second || best.matchStem.length > second.matchStem.length) {
    return best
  }

  return null
}

function buildTimestamp() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function buildCurrentDate() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function createEmptyRow(length: number) {
  return Array.from({ length }, () => '')
}

function createMonthSeparatorRow(monthName: string, length: number) {
  const row = createEmptyRow(length)
  row[SHEET_TOTAL_VALUE_COLUMN_INDEX - 1] = monthName
  return row
}

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function pemToArrayBuffer(pem: string) {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function getGoogleAccessToken() {
  const jsonCredentials = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  const parsedCredentials = jsonCredentials ? JSON.parse(jsonCredentials) : null
  const clientEmail = parsedCredentials?.client_email || Deno.env.get('GOOGLE_CLIENT_EMAIL')
  const privateKey = parsedCredentials?.private_key || Deno.env.get('GOOGLE_PRIVATE_KEY')

  if (!clientEmail || !privateKey) {
    throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_JSON ou GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: clientEmail,
    scope: GOOGLE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const payloadResponse = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`Google OAuth respondeu ${response.status}: ${JSON.stringify(payloadResponse)}`)
  }
  return payloadResponse.access_token as string
}

class GoogleSheetsService {
  spreadsheetId: string
  accessToken: string

  constructor(spreadsheetId: string, accessToken: string) {
    this.spreadsheetId = spreadsheetId
    this.accessToken = accessToken
  }

  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.headers || {}),
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(`Google Sheets respondeu ${response.status}: ${JSON.stringify(payload)}`)
    }
    return payload
  }

  async readSheetValues(sheetName: string): Promise<SheetValues> {
    const range = encodeURIComponent(quoteSheetName(sheetName))
    const payload = await this.request(`/values/${range}?valueRenderOption=FORMATTED_VALUE`)
    return payload.values || []
  }

  async getSheetProperties(sheetName: string) {
    const metadata = await this.request('?fields=sheets.properties(sheetId,title,gridProperties.columnCount,gridProperties.rowCount)')
    const sheet = (metadata.sheets || []).find(
      (item: { properties?: { title?: string } }) => item.properties?.title === sheetName,
    )

    if (sheet?.properties?.sheetId === undefined) {
      throw new Error(`A aba ${sheetName} nao foi encontrada na planilha.`)
    }

    return {
      sheetId: sheet.properties.sheetId as number,
      columnCount: Number(sheet.properties.gridProperties?.columnCount || 0),
      rowCount: Number(sheet.properties.gridProperties?.rowCount || 0),
    }
  }

  async ensureColumnCapacity(sheetName: string, minColumnCount: number) {
    const { sheetId, columnCount } = await this.getSheetProperties(sheetName)
    if (columnCount >= minColumnCount) return

    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            appendDimension: {
              sheetId,
              dimension: 'COLUMNS',
              length: minColumnCount - columnCount,
            },
          },
        ],
      }),
    })
  }

  async ensureDropdownFormatting(sheetName: string, columns: TargetColumn[], minRowCount: number) {
    const statusColumn = columns.find((column) => column.role === 'recordStatus')
    const stageColumn = columns.find((column) => column.role === 'stageName')
    if (!statusColumn && !stageColumn) return

    const metadata = await this.request('?fields=sheets(properties(sheetId,title),conditionalFormats)')
    const sheet = (metadata.sheets || []).find(
      (item: { properties?: { title?: string } }) => item.properties?.title === sheetName,
    )
    const sheetId = sheet?.properties?.sheetId
    if (sheetId === undefined) return

    const targetColumnIndexes = new Set(
      [statusColumn?.index, stageColumn?.index].filter((index): index is number => Boolean(index)),
    )
    const targetValues = new Set([...STATUS_OPTIONS, ...REGUA_OPTIONS])
    const existingFormatRules = (sheet.conditionalFormats || []) as Array<{
      ranges?: Array<{ startColumnIndex?: number; endColumnIndex?: number }>
      booleanRule?: { condition?: { type?: string; values?: Array<{ userEnteredValue?: string }> } }
    }>

    const requests: Array<Record<string, unknown>> = existingFormatRules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => {
        const condition = rule.booleanRule?.condition
        if (condition?.type !== 'TEXT_EQ') return false
        const value = condition.values?.[0]?.userEnteredValue || ''
        if (!targetValues.has(value)) return false

        return (rule.ranges || []).some((range) => {
          const startColumn = Number(range.startColumnIndex || 0) + 1
          const endColumn = Number(range.endColumnIndex || startColumn)
          return [...targetColumnIndexes].some((columnIndex) => columnIndex >= startColumn && columnIndex < endColumn)
        })
      })
      .sort((left, right) => right.index - left.index)
      .map(({ index }) => ({ deleteConditionalFormatRule: { sheetId, index } }))

    const endRowIndex = Math.max(minRowCount, 2)
    const addValidationRequest = (columnIndex: number, options: string[]) => {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex,
            startColumnIndex: columnIndex - 1,
            endColumnIndex: columnIndex,
          },
          cell: {
            dataValidation: {
              condition: {
                type: 'ONE_OF_LIST',
                values: options.map((option) => ({ userEnteredValue: option })),
              },
              strict: false,
              showCustomUi: true,
            },
          },
          fields: 'dataValidation',
        },
      })
    }

    if (statusColumn) {
      addValidationRequest(statusColumn.index, STATUS_OPTIONS)
      for (const color of STATUS_COLORS) {
        requests.push(
          buildTextEqualsFormatRule(
            sheetId,
            statusColumn.index,
            color.value,
            color.background,
            color.foreground,
            color.bold,
          ),
        )
      }
    }

    if (stageColumn) {
      addValidationRequest(stageColumn.index, REGUA_OPTIONS)
      for (const color of REGUA_COLORS) {
        requests.push(
          buildTextEqualsFormatRule(
            sheetId,
            stageColumn.index,
            color.value,
            color.background,
            color.foreground,
            color.bold,
          ),
        )
      }
    }

    if (requests.length === 0) return

    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests }),
    })
  }

  async formatMonthSeparatorRows(sheetName: string, rowNumbers: number[]) {
    const uniqueRows = [...new Set(rowNumbers)].filter((rowNumber) => rowNumber >= 2)
    if (uniqueRows.length === 0) return

    const { sheetId } = await this.getSheetProperties(sheetName)
    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: uniqueRows.map((rowNumber) => ({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: TARGET_START_COLUMN_INDEX - 1,
              endColumnIndex: TARGET_END_COLUMN_INDEX,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: hexToGoogleColor('#cfe2f3'),
                horizontalAlignment: 'CENTER',
                textFormat: {
                  bold: true,
                },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat.bold)',
          },
        })),
      }),
    })
  }

  async formatMonthlyLayoutRows(sheetName: string, lastRowNumber: number, separatorRows: number[]) {
    if (lastRowNumber < 2) return

    const { sheetId } = await this.getSheetProperties(sheetName)
    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 1,
                endRowIndex: lastRowNumber,
                startColumnIndex: TARGET_START_COLUMN_INDEX - 1,
                endColumnIndex: TARGET_END_COLUMN_INDEX,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: hexToGoogleColor('#ffffff'),
                  textFormat: {
                    bold: false,
                  },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
            },
          },
          ...[...new Set(separatorRows)]
            .filter((rowNumber) => rowNumber >= 2)
            .map((rowNumber) => ({
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: TARGET_START_COLUMN_INDEX - 1,
                  endColumnIndex: TARGET_END_COLUMN_INDEX,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: hexToGoogleColor('#cfe2f3'),
                    horizontalAlignment: 'CENTER',
                    textFormat: {
                      bold: true,
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat.bold)',
              },
            })),
        ],
      }),
    })
  }

  async insertRows(sheetName: string, insertions: Array<{ rowNumber: number; count: number }>) {
    if (insertions.length === 0) return

    const { sheetId } = await this.getSheetProperties(sheetName)
    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: insertions.map((insertion) => ({
          insertDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: insertion.rowNumber - 1,
              endIndex: insertion.rowNumber - 1 + insertion.count,
            },
            inheritFromBefore: insertion.rowNumber > 2,
          },
        })),
      }),
    })
  }

  async ensureRowCapacity(sheetName: string, minRowCount: number) {
    const { sheetId, rowCount } = await this.getSheetProperties(sheetName)
    if (rowCount >= minRowCount) return

    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            appendDimension: {
              sheetId,
              dimension: 'ROWS',
              length: minRowCount - rowCount,
            },
          },
        ],
      }),
    })
  }

  async ensureLogSheet() {
    const metadata = await this.request('?fields=sheets.properties.title')
    const exists = (metadata.sheets || []).some(
      (sheet: { properties?: { title?: string } }) => sheet.properties?.title === LOG_SHEET_NAME,
    )

    if (exists) {
      await this.initializeLogSheetLayout()
      return
    }

    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: LOG_SHEET_NAME } } }],
      }),
    })
    await this.initializeLogSheetLayout()
  }

  async initializeLogSheetLayout() {
    await this.batchUpdateValues([
      {
        range: `${quoteSheetName(LOG_SHEET_NAME)}!A1:I1`,
        values: [['Data/hora', 'Linha', 'Cliente', 'Status', 'Ação', 'Origens', 'Mensagem de erro', 'Detalhes', 'Card Trello']],
      },
      {
        range: `${quoteSheetName(LOG_SHEET_NAME)}!K1:O20`,
        values: Array.from({ length: 20 }, () => Array.from({ length: 5 }, () => '')),
      },
    ])
  }

  async updateLogDashboard(_summary: LogDashboardSummary) {
    return
  }

  async updateValues(range: string, values: SheetValues) {
    await this.request(`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: JSON.stringify({ values }),
    })
  }

  async batchUpdateValues(data: Array<{ range: string; values: SheetValues }>) {
    if (data.length === 0) return
    await this.request('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data,
      }),
    })
  }

  async appendLogRows(rows: SheetValues, clearExisting = true) {
    if (clearExisting) {
      await this.request('/values:batchClear', {
        method: 'POST',
        body: JSON.stringify({
          ranges: [`${quoteSheetName(LOG_SHEET_NAME)}!A2:I5000`],
        }),
      })
    }

    if (rows.length === 0) return

    if (clearExisting) {
      await this.updateValues(
        `${quoteSheetName(LOG_SHEET_NAME)}!A2:I${rows.length + 1}`,
        rows,
      )
      return
    }

    await this.request(`/values/${encodeURIComponent(`${quoteSheetName(LOG_SHEET_NAME)}!A2:I2`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    })
  }
}

class TrelloService {
  apiKey: string | null
  token: string | null
  boardId: string | null
  listIds: Set<string>
  listNameCache = new Map<string, string>()
  clientLookupCache = new Map<string, Promise<TrelloLookupResult>>()
  baseUrl = 'https://api.trello.com/1'

  constructor(apiKey: string | null, token: string | null, boardId: string | null, listIds: string[]) {
    this.apiKey = apiKey
    this.token = token
    this.boardId = boardId
    this.listIds = new Set(listIds.filter(Boolean))
  }

  isConfigured() {
    return Boolean(this.apiKey && this.token)
  }

  async get(path: string, params: Record<string, string> = {}) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello nao configurado.')
    }

    const url = new URL(`${this.baseUrl}${path}`)
    url.searchParams.set('key', this.apiKey)
    url.searchParams.set('token', this.token)
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Trello respondeu ${response.status}: ${await response.text()}`)
    }
    return response.json()
  }

  async searchClientCard(clientName: string): Promise<TrelloLookupResult> {
    const cacheKey = [
      this.boardId || 'all-boards',
      [...this.listIds].sort().join(',') || 'all-lists',
      normalizeClientName(clientName),
    ].join('|')
    const cached = this.clientLookupCache.get(cacheKey)
    if (cached) {
      return cached
    }
    const sharedCached = trelloLookupCache.get(cacheKey)
    if (sharedCached && sharedCached.expiresAt > Date.now()) {
      this.clientLookupCache.set(cacheKey, sharedCached.promise)
      return sharedCached.promise
    }
    if (sharedCached) {
      trelloLookupCache.delete(cacheKey)
    }

    const lookupPromise = this.searchClientCardInternal(clientName)
    this.clientLookupCache.set(cacheKey, lookupPromise)
    trelloLookupCache.set(cacheKey, {
      expiresAt: Date.now() + TRELLO_LOOKUP_CACHE_TTL_MS,
      promise: lookupPromise,
    })
    return lookupPromise
  }

  async searchClientCardInternal(clientName: string): Promise<TrelloLookupResult> {
    if (!this.isConfigured()) {
      return {
        found: false,
        resultLabel: 'Trello nao configurado',
        situation: '',
        statusLabel: 'ATIVO',
        actionDate: '',
        cardUrl: '',
        error: 'Falha na consulta ao Trello: integracao nao configurada.',
      }
    }

    try {
      const cards = await this.searchCards(clientName)
      const selected = this.chooseBestCard(clientName, cards)
      if (!selected?.id) {
        return {
          found: false,
          resultLabel: 'Nao localizado no Trello',
          situation: '',
          statusLabel: 'ATIVO',
          actionDate: '',
          cardUrl: '',
        }
      }

      const listName = await this.getListName(selected.idList)
      const labels = (selected.labels || []).map((label) => label.name).filter(Boolean)
      return {
        found: true,
        resultLabel: 'Localizado no Trello',
        situation: await this.summarizeSituation(selected),
        statusLabel: resolveStatusOption(listName, ...labels, selected.name, selected.desc),
        actionDate: extractActionDate(selected),
        cardUrl: selected.shortUrl || selected.url || '',
      }
    } catch (error) {
      return {
        found: false,
        resultLabel: 'Erro ao consultar Trello',
        situation: '',
        statusLabel: 'ATIVO',
        actionDate: '',
        cardUrl: '',
        error: `Falha na consulta ao Trello: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      }
    }
  }

  async searchCards(clientName: string): Promise<TrelloCard[]> {
    const params: Record<string, string> = {
      query: clientName,
      modelTypes: 'cards',
      card_fields: 'name,desc,idBoard,idList,shortUrl,url,due,dateLastActivity,closed,labels',
      cards_limit: '8',
    }
    if (this.boardId) params.idBoards = this.boardId

    const payload = await this.get('/search', params)
    const cards = (payload.cards || []) as TrelloCard[]
    return cards.filter((card) => {
      if (card.closed) return false
      if (this.listIds.size > 0 && card.idList && !this.listIds.has(card.idList)) return false
      return true
    })
  }

  chooseBestCard(clientName: string, cards: TrelloCard[]) {
    const clientTokens = new Set(normalizeClientName(clientName).split(' ').filter(Boolean))

    function score(card: TrelloCard) {
      const name = normalizeClientName(card.name)
      const description = normalizeClientName(card.desc)
      const nameTokens = new Set(name.split(' ').filter(Boolean))
      const descriptionTokens = new Set(description.split(' ').filter(Boolean))
      const sharedName = [...clientTokens].filter((token) => nameTokens.has(token)).length
      const sharedDescription = [...clientTokens].filter((token) => descriptionTokens.has(token)).length
      const exactBoost = name.includes(normalizeClientName(clientName)) ? 100 : 0
      return exactBoost + sharedName * 10 + sharedDescription * 2
    }

    return cards.sort((a, b) => score(b) - score(a))[0]
  }

  async getListName(listId?: string) {
    if (!listId) return ''
    const cached = this.listNameCache.get(listId)
    if (cached) return cached
    const payload = await this.get(`/lists/${listId}`, { fields: 'name' })
    const name = payload.name || ''
    this.listNameCache.set(listId, name)
    return name
  }

  async summarizeSituation(card: TrelloCard) {
    const listName = await this.getListName(card.idList)
    const labels = (card.labels || []).map((label) => label.name).filter(Boolean)
    const latestComment = (card.actions || []).find((action) => action.type === 'commentCard')?.data?.text
    const regua = resolveReguaOption(listName, ...labels, latestComment, card.name, card.desc)
    if (regua && REGUA_OPTIONS.includes(regua)) return regua
    return ''
  }
}

class IntegraService {
  baseUrl: string | null
  token: string | null
  searchPath: string
  nameParam: string
  clientLookupCache = new Map<string, Promise<IntegraLookupResult>>()

  constructor() {
    this.baseUrl = Deno.env.get('INTEGRA_API_URL') || null
    this.token = Deno.env.get('INTEGRA_API_TOKEN') || null
    this.searchPath = Deno.env.get('INTEGRA_API_SEARCH_PATH') || '/clients/search'
    this.nameParam = Deno.env.get('INTEGRA_API_NAME_PARAM') || 'name'
  }

  isConfigured() {
    return Boolean(this.baseUrl)
  }

  async lookupClient(clientName: string): Promise<IntegraLookupResult> {
    const cacheKey = normalizeClientName(clientName)
    const cached = this.clientLookupCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const lookupPromise = this.lookupClientInternal(clientName)
    this.clientLookupCache.set(cacheKey, lookupPromise)
    return lookupPromise
  }

  async lookupClientInternal(clientName: string): Promise<IntegraLookupResult> {
    if (!this.baseUrl) {
      return {
        found: false,
        status: '',
        dueDate: '',
        amount: null,
        openAmount: null,
        paidAmount: null,
        upcomingAmount: null,
        description: '',
        error: 'Falha na consulta ao Integra: integracao nao configurada.',
      }
    }

    try {
      const url = new URL(this.searchPath, this.baseUrl)
      url.searchParams.set(this.nameParam, clientName)

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(`Integra respondeu ${response.status}: ${JSON.stringify(payload)}`)
      }

      const record = pickObject(payload)
      if (!record) {
        return {
          found: false,
          status: '',
          dueDate: '',
          amount: null,
          openAmount: null,
          paidAmount: null,
          upcomingAmount: null,
          description: '',
        }
      }

      return {
        found: true,
        status: String(
          pickField(record, ['status', 'financeiro', 'situacao', 'situacao_financeira']) || '',
        ).trim(),
        dueDate: normalizeDate(
          pickField(record, ['dueDate', 'due_date', 'vencimento', 'data_vencimento', 'dataVencimento']) || '',
        ),
        amount: parseAmount(
          pickField(record, ['amount', 'valor', 'value', 'valor_total', 'total']),
        ),
        openAmount: parseAmount(
          pickField(record, ['openAmount', 'valor_em_aberto', 'valorEmAberto', 'saldo_aberto']),
        ),
        paidAmount: parseAmount(
          pickField(record, ['paidAmount', 'valor_pago', 'valorPago']),
        ),
        upcomingAmount: parseAmount(
          pickField(record, ['upcomingAmount', 'valor_a_vencer', 'valorAVencer']),
        ),
        description: String(
          pickField(record, ['description', 'descricao', 'parcela', 'observacao']) || '',
        ).trim(),
      }
    } catch (error) {
      return {
        found: false,
        status: '',
        dueDate: '',
        amount: null,
        openAmount: null,
        paidAmount: null,
        upcomingAmount: null,
        description: '',
        error: `Falha na consulta ao Integra: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      }
    }
  }
}

function extractActionDate(card: TrelloCard) {
  const text = [card.desc || '', ...(card.actions || []).map((action) => action.data?.text || '')].join('\n')
  const dateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/)
  if (dateMatch) {
    const [, day, month, year] = dateMatch
    const normalizedYear = year.length === 2 ? `20${year}` : year
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${normalizedYear}`
  }

  const actionDate = card.actions?.find((action) => action.date)?.date || card.dateLastActivity
  if (!actionDate) return ''

  try {
    return new Date(actionDate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  } catch {
    return ''
  }
}

function extractInstallmentNumber(description: string) {
  const match = String(description || '').match(/\b(\d{1,3})\s*(?:a|ª|o)?\s*parcela\b/i)
  if (!match) return null

  const installmentNumber = Number(match[1])
  return Number.isFinite(installmentNumber) && installmentNumber > 0 ? installmentNumber : null
}

function deriveDueDateFromContract(
  contractDate: string,
  dueDay: string,
  description: string,
  fallbackDueDate: string,
) {
  const normalizedFallback = normalizeDate(fallbackDueDate)
  const baseDate = parseBrDate(contractDate)
  if (!baseDate) return normalizedFallback

  const installmentNumber = extractInstallmentNumber(description) || 1
  const parsedDueDay = Number(String(dueDay || '').trim())
  const referenceDay =
    Number.isFinite(parsedDueDay) && parsedDueDay >= 1 && parsedDueDay <= 31
      ? parsedDueDay
      : baseDate.getDate()

  const targetDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth() + Math.max(installmentNumber - 1, 0),
    1,
    12,
    0,
    0,
  )
  const lastDayOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 12, 0, 0).getDate()
  targetDate.setDate(Math.min(referenceDay, lastDayOfMonth))

  return formatBrDate(targetDate)
}

function deriveInstallmentAmounts(
  totalAmount: number | null,
  installmentNumber: number | null,
  parcelAmount: number | null,
  status: string,
) {
  if (totalAmount === null || installmentNumber === null || parcelAmount === null) {
    return null
  }

  const safeTotal = Math.max(totalAmount, 0)
  const safeParcel = Math.max(parcelAmount, 0)
  const paidBase = Math.min(Math.max((installmentNumber - 1) * safeParcel, 0), safeTotal)

  if (status === 'QUITADO') {
    return { openAmount: 0, paidAmount: safeTotal, upcomingAmount: 0 }
  }

  if (status === 'EM ATRASO') {
    const openAmount = Math.min(safeParcel, Math.max(safeTotal - paidBase, 0))
    const upcomingAmount = Math.max(safeTotal - paidBase - openAmount, 0)
    return { openAmount, paidAmount: paidBase, upcomingAmount }
  }

  return {
    openAmount: 0,
    paidAmount: paidBase,
    upcomingAmount: Math.max(safeTotal - paidBase, 0),
  }
}

function deriveFinancialStatus(
  integraStatus: string,
  sourceFinancialStatus: string,
  totalAmount: number | null,
  amount: number | null,
  openAmount: number | null,
  paidAmount: number | null,
  upcomingAmount: number | null,
) {
  const isFullPayment =
    amountsMatch(totalAmount, amount) ||
    (totalAmount !== null && totalAmount > 0 && (paidAmount || 0) >= totalAmount && (openAmount || 0) <= 0 && (upcomingAmount || 0) <= 0)
  const normalizedIntegraStatus = normalizeStatus(integraStatus)
  if (normalizedIntegraStatus === 'QUITADO') return isFullPayment ? 'QUITADO' : 'EM DIA'
  if (normalizedIntegraStatus) return normalizedIntegraStatus
  const normalizedSourceStatus = normalizeStatus(sourceFinancialStatus)
  if (normalizedSourceStatus === 'QUITADO') return isFullPayment ? 'QUITADO' : 'EM DIA'
  if (normalizedSourceStatus) return normalizedSourceStatus
  if ((paidAmount || 0) > 0 && (openAmount || 0) <= 0) {
    return totalAmount !== null && totalAmount > 0 ? (paidAmount >= totalAmount ? 'QUITADO' : 'EM DIA') : 'QUITADO'
  }
  if ((upcomingAmount || 0) > 0) return 'A VENCER'
  if ((openAmount || 0) > 0) return 'EM ATRASO'
  return amount ? 'EM DIA' : ''
}

function deriveManualFinancialStatus(
  currentStatus: string,
  selectedMatch: SelectedProcessMatch | undefined,
  openAmount: number | null,
  paidAmount: number | null,
  upcomingAmount: number | null,
) {
  if (!selectedMatch?.hasManualAmounts) return currentStatus
  if ((openAmount || 0) > 0) return 'EM ATRASO'
  if ((upcomingAmount || 0) > 0) return 'A VENCER'
  if ((paidAmount || 0) > 0) return 'QUITADO'
  return currentStatus
}

function deriveEntryFinancialStatus(upcomingAmount: number | null) {
  return 'EM DIA'
}

function deriveFinalFinancialStatus(
  baseStatus: string,
  totalAmount: number | null,
  amount: number | null,
  openAmount: number | null,
  paidAmount: number | null,
  upcomingAmount: number | null,
  description: string,
) {
  const open = openAmount || 0
  const paid = paidAmount || 0
  const upcoming = upcomingAmount || 0
  const total = totalAmount || 0

  if (isEntryDescription(description) && paid > 0) {
    return deriveEntryFinancialStatus(upcomingAmount)
  }

  if (open > 0) return 'EM ATRASO'
  if (total > 0 && (paid >= total || amountsMatch(totalAmount, amount))) return 'QUITADO'
  if (upcoming > 0 || (total > 0 && paid > 0 && paid < total)) return 'EM DIA'
  if (baseStatus === 'A VENCER') return 'EM DIA'
  return baseStatus
}

function applyManualAmountOverrides(
  amounts: { openAmount: number | null; paidAmount: number | null; upcomingAmount: number | null },
  selectedMatch: SelectedProcessMatch | undefined,
) {
  return {
    openAmount: selectedMatch?.openAmount ?? amounts.openAmount,
    paidAmount: selectedMatch?.paidAmount ?? amounts.paidAmount,
    upcomingAmount: selectedMatch?.upcomingAmount ?? amounts.upcomingAmount,
  }
}

function deriveAmounts(
  totalAmount: number | null,
  status: string,
  amount: number | null,
  description: string,
  integra: IntegraLookupResult,
) {
  const parsedAmount = amount && Number.isFinite(amount) ? amount : null
  const openAmount = integra.openAmount
  const paidAmount = integra.paidAmount
  const upcomingAmount = integra.upcomingAmount
  const isEntry = isEntryDescription(description)

  if (isEntry && parsedAmount !== null) {
    return {
      openAmount: 0,
      paidAmount: parsedAmount,
      upcomingAmount: totalAmount !== null && totalAmount > parsedAmount ? Math.max(totalAmount - parsedAmount, 0) : 0,
    }
  }

  if (openAmount !== null || paidAmount !== null || upcomingAmount !== null) {
    return {
      openAmount,
      paidAmount,
      upcomingAmount,
    }
  }

  const installmentNumber = extractInstallmentNumber(description)
  const installmentAmounts = deriveInstallmentAmounts(totalAmount, installmentNumber, parsedAmount, status)
  if (installmentAmounts) {
    return installmentAmounts
  }

  if (parsedAmount === null) {
    return { openAmount: null, paidAmount: null, upcomingAmount: null }
  }

  if (status === 'QUITADO') {
    return { openAmount: 0, paidAmount: parsedAmount, upcomingAmount: 0 }
  }

  if (status === 'EM ATRASO') {
    if (totalAmount !== null && totalAmount > parsedAmount) {
      return {
        openAmount: parsedAmount,
        paidAmount: 0,
        upcomingAmount: Math.max(totalAmount - parsedAmount, 0),
      }
    }

    return { openAmount: parsedAmount, paidAmount: 0, upcomingAmount: 0 }
  }

  return { openAmount: 0, paidAmount: 0, upcomingAmount: parsedAmount }
}

function deriveRecordStatus(trello: TrelloLookupResult) {
  return trello.statusLabel || 'ATIVO'
}

function isEntryManualAdjustment(selectedMatch: SelectedProcessMatch | undefined) {
  return isEntryDescription(selectedMatch?.description || '')
}

function deriveTrelloForUpdate(trello: TrelloLookupResult, selectedMatch: SelectedProcessMatch | undefined) {
  if (!selectedMatch?.hasManualAdjustment) return trello
  if (isEntryManualAdjustment(selectedMatch)) return trello

  return {
    ...trello,
    found: true,
    situation: 'Renegociado',
    resultLabel: trello.resultLabel
      ? `${trello.resultLabel} | Régua manual: Renegociado`
      : 'Régua manual: Renegociado',
  }
}

function computeColumnValue(
  column: TargetColumn,
  timestamp: string,
  executionDate: string,
  sourceCode: string,
  sourceDate: string,
  sources: string[],
  errorMessage: string,
  status: string,
  dueDate: string,
  description: string,
  totalAmount: number | null,
  amount: number | null,
  openAmount: number | null,
  paidAmount: number | null,
  upcomingAmount: number | null,
  trello: TrelloLookupResult,
) {
  switch (column.role) {
    case 'sourceCode':
      return sourceCode
    case 'fillDate':
      return sourceDate
    case 'dueDate':
      return dueDate
    case 'amount':
      return sheetNumber(totalAmount)
    case 'description':
      return description
    case 'financialStatus':
      return status
    case 'recordStatus':
      return deriveRecordStatus(trello)
    case 'openAmount':
      return sheetNumber(openAmount ?? 0)
    case 'paidAmount':
      return sheetNumber(paidAmount ?? 0)
    case 'upcomingAmount':
      return sheetNumber(upcomingAmount ?? 0)
    case 'daysOverdue': {
      const diffDays = dueDate ? diffDaysFromToday(dueDate) : null
      return diffDays && diffDays > 0 ? String(diffDays) : '0'
    }
    case 'stageName':
      return trello.situation
    case 'trelloActionDate':
      return trello.actionDate
    case 'stageDays': {
      const diffDays = trello.actionDate ? diffDaysFromToday(trello.actionDate) : null
      return diffDays !== null && diffDays >= 0 ? String(diffDays) : ''
    }
    case 'updatedAt':
      return executionDate
    default:
      return ''
  }
}

function buildUpdatePlan(
  row: SheetClientRow,
  columns: TargetColumn[],
  timestamp: string,
  executionDate: string,
  sourceCode: string,
  sourceDate: string,
  sources: string[],
  errorMessage: string,
  status: string,
  dueDate: string,
  description: string,
  totalAmount: number | null,
  amount: number | null,
  openAmount: number | null,
  paidAmount: number | null,
  upcomingAmount: number | null,
  trello: TrelloLookupResult,
) {
  const changedColumns = new Set<number>()
  const dateColumns: number[] = []
  const newValues = new Map<number, string>()
  const changedColumnLabels: string[] = []

  for (const column of columns) {
    if (!column.role) continue
    const currentValue = getCell(row.values, column.index)
    let nextValue = computeColumnValue(
      column,
      timestamp,
      executionDate,
      sourceCode,
      sourceDate,
      sources,
      errorMessage,
      status,
      dueDate,
      description,
      totalAmount,
      amount,
      openAmount,
      paidAmount,
      upcomingAmount,
      trello,
    )

    if (
      (column.role === 'stageName' || column.role === 'trelloActionDate' || column.role === 'stageDays') &&
      !String(nextValue || '').trim()
    ) {
      nextValue = currentValue
    }

    newValues.set(column.index, nextValue)

    if (column.role === 'updatedAt') {
      dateColumns.push(column.index)
      continue
    }

    if (compareValue(currentValue) !== compareValue(nextValue)) {
      changedColumns.add(column.index)
    }
  }

  const updateColumns = new Set<number>()
  let action = 'ignorado'
  if (changedColumns.size > 0) {
    action = 'atualizado'
    changedColumns.forEach((index) => updateColumns.add(index))
    dateColumns.forEach((index) => updateColumns.add(index))
  } else if (dateColumns.length > 0) {
    action = 'data_atualizada'
    dateColumns.forEach((index) => updateColumns.add(index))
  }

  for (const column of columns) {
    if (!changedColumns.has(column.index)) continue
    changedColumnLabels.push(column.header || columnLetter(column.index))
  }

  const requests = [...updateColumns].map((columnIndex) => ({
    range: `${quoteSheetName('PLACEHOLDER')}!${columnLetter(columnIndex)}${row.rowNumber}`,
    values: [[newValues.get(columnIndex) || '']],
  }))

  return {
    action,
    changedCount: requests.length,
    changedColumnLabels,
    requests,
  }
}

function resolveStageForMetrics(row: SheetClientRow, columns: TargetColumn[], trello: TrelloLookupResult) {
  if (trello.situation) return trello.situation

  const stageColumn = columns.find((column) => column.role === 'stageName')
  if (!stageColumn) return ''

  return getCell(row.values, stageColumn.index)
}

function buildLogRow(entry: AutomationLogEntry): string[] {
  return [
    entry.timestamp,
    entry.rowNumber ? String(entry.rowNumber) : '',
    entry.clientName,
    entry.status,
    entry.action,
    entry.sources.join(', '),
    entry.errorMessage,
    entry.details,
    entry.cardUrl,
  ]
}

function buildPreviewRow(entry: AutomationLogEntry): AutomationPreviewRow {
  return {
    rowNumber: entry.rowNumber,
    clientName: entry.clientName,
    action: entry.action,
    status: entry.status,
    sources: entry.sources,
    errorMessage: entry.errorMessage,
    cardUrl: entry.cardUrl,
  }
}

function incrementMetric(map: Map<string, number>, label: string) {
  if (!label) return
  map.set(label, (map.get(label) || 0) + 1)
}

function metricMapToArray(map: Map<string, number>, preferredOrder: string[] = []) {
  const remaining = new Set(map.keys())
  const ordered = preferredOrder
    .filter((label) => remaining.has(label))
    .map((label) => {
      remaining.delete(label)
      return { label, value: map.get(label) || 0 }
    })

  const trailing = [...remaining]
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
    .map((label) => ({ label, value: map.get(label) || 0 }))

  return [...ordered, ...trailing]
}

function addSheetRequest(
  requests: Array<{ range: string; values: SheetValues }>,
  sheetName: string,
  range: string,
  values: SheetValues,
) {
  requests.push({
    range: range.replace(quoteSheetName('PLACEHOLDER'), quoteSheetName(sheetName)),
    values,
  })
}

function buildSheetRowLookup(rows: SheetClientRow[]) {
  const exactLookup = new Map<string, SheetClientRow[]>()
  for (const row of rows) {
    const bucket = exactLookup.get(row.normalizedName) || []
    bucket.push(row)
    exactLookup.set(row.normalizedName, bucket)
  }

  return { rows, exactLookup }
}

function resolveSheetRowForPdfRecord(
  pdfRecord: PreparedPdfRecord,
  sheetLookup: ReturnType<typeof buildSheetRowLookup>,
  usedRowNumbers: Set<number>,
  preferredCode = '',
) {
  const exactMatches = (sheetLookup.exactLookup.get(pdfRecord.normalizedName) || []).filter(
    (row) => !usedRowNumbers.has(row.rowNumber),
  )

  if (preferredCode) {
    const codeMatch = exactMatches.find(
      (row) => normalizeHeader(getCell(row.values, 5)) === normalizeHeader(preferredCode),
    )
    if (codeMatch) {
      return codeMatch
    }
  }

  if (exactMatches.length > 0) {
    return exactMatches[0]
  }

  const truncatedMatches = sheetLookup.rows
    .filter((row) => !usedRowNumbers.has(row.rowNumber))
    .filter(
      (row) =>
        (pdfRecord.truncated && canMatchTruncatedName(row.normalizedName, pdfRecord.matchStem)) ||
        canMatchShortenedName(row.normalizedName, pdfRecord.matchStem),
    )
    .sort((left, right) => left.normalizedName.length - right.normalizedName.length)

  return truncatedMatches[0] || null
}

async function assertCanRun(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  if (!supabaseUrl || !anonKey) return

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('Usuario nao autenticado.')

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Usuario nao autenticado.')

  const requireAdmin = (Deno.env.get('AUTOMATION_REQUIRE_ADMIN') || 'true').toLowerCase() !== 'false'
  const rpcName = requireAdmin ? 'is_admin' : 'is_approved'
  const { data, error: rpcError } = await supabase.rpc(rpcName, { _user_id: user.id })
  if (rpcError || !data) {
    throw new Error(requireAdmin ? 'Apenas administradores podem executar a automacao.' : 'Usuario nao aprovado.')
  }
}

async function normalizeMonthlySheetLayout(
  sheets: GoogleSheetsService,
  sheetName: string,
  dryRun: boolean,
): Promise<AutomationResult> {
  const timestamp = buildTimestamp()
  const values = await sheets.readSheetValues(sheetName)
  const sortedLayout = buildSortedMonthlySheetLayout(values, TARGET_END_COLUMN_INDEX)

  if (!dryRun) {
    await sheets.ensureRowCapacity(sheetName, sortedLayout.lastRowNumber)
    await sheets.updateValues(
      `${quoteSheetName(sheetName)}!A2:${columnLetter(TARGET_END_COLUMN_INDEX)}${sortedLayout.lastRowNumber}`,
      sortedLayout.values,
    )
    await sheets.formatMonthlyLayoutRows(sheetName, sortedLayout.lastRowNumber, sortedLayout.separatorRows)
  }

  const preview = sortedLayout.separatorRows.map((rowNumber) => ({
    rowNumber,
    clientName: String(getCell(sortedLayout.values[rowNumber - 2] || [], SHEET_TOTAL_VALUE_COLUMN_INDEX) || ''),
    action: dryRun ? 'Prévia da organização mensal' : 'Organização mensal aplicada',
    status: 'mes_corrigido',
    sources: ['Google Sheets'],
    errorMessage: '',
    cardUrl: '',
  }))

  return {
    dryRun,
    sheetName,
    pdfFileName: '',
    timestamp,
    startRow: 2,
    processed: Math.max(findLastFilledRow(values) - 1, 0),
    skipped: 0,
    matched: 0,
    updated: dryRun ? 0 : sortedLayout.values.length,
    refreshed: 0,
    ignored: 0,
    notFound: 0,
    errors: 0,
    updatedCells: dryRun ? 0 : 1,
    logRows: 0,
    preview,
    pendingCount: 0,
    pendingSelections: [],
    dashboard: {
      created: 0,
      updated: dryRun ? 0 : sortedLayout.values.length,
      refreshed: 0,
      pending: 0,
      notFound: 0,
      errors: 0,
      matched: 0,
      processed: Math.max(findLastFilledRow(values) - 1, 0),
      financial: {
        openAmount: 0,
        paidAmount: 0,
        upcomingAmount: 0,
      },
      stageBreakdown: [],
      recordStatusBreakdown: [],
      actionBreakdown: [],
    },
  }
}

function dashboardMainRange(sheetName: string, column: string) {
  return `${quoteSheetName(sheetName)}!${column}2:${column}${DASHBOARD_DATA_LAST_ROW}`
}

function dashboardCurrencyArray(sheetName: string, column: string) {
  const range = dashboardMainRange(sheetName, column)
  return `ARRAYFORMULA(IFERROR(VALUE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(TO_TEXT(${range}),"R$",""),".",""),",",".")),0))`
}

function dashboardDateYearArray(sheetName: string) {
  const range = dashboardMainRange(sheetName, 'A')
  return `ARRAYFORMULA(IFERROR(YEAR(${range}),IFERROR(YEAR(DATEVALUE(TO_TEXT(${range}))),0)))`
}

function dashboardMonthKeyArray(sheetName: string) {
  const range = dashboardMainRange(sheetName, 'A')
  return `ARRAYFORMULA(IFERROR(TEXT(${range},"yyyy/mm"),IFERROR(TEXT(DATEVALUE(TO_TEXT(${range})),"yyyy/mm"),"")))`
}

function dashboardCurrencySum(sheetName: string, column: string) {
  return `=SUM(${dashboardCurrencyArray(sheetName, column)})`
}

function dashboardCurrencySumIf(sheetName: string, column: string, statusRegex: string) {
  return `=IFERROR(SUM(FILTER(${dashboardCurrencyArray(sheetName, column)},${dashboardMainRange(sheetName, 'I')}<>"",REGEXMATCH(UPPER(TO_TEXT(${dashboardMainRange(sheetName, 'O')})),"${statusRegex}"))),0)`
}

function dashboardCurrencySumByColumnValue(sheetName: string, amountColumn: string, criteriaColumn: string, criteriaCell: string) {
  return `=IFERROR(SUM(FILTER(${dashboardCurrencyArray(sheetName, amountColumn)},${dashboardMainRange(sheetName, criteriaColumn)}=${criteriaCell})),0)`
}

function dashboardCurrencySumByYear(sheetName: string, column: string, yearCell: string) {
  return `=IFERROR(SUM(FILTER(${dashboardCurrencyArray(sheetName, column)},${dashboardDateYearArray(sheetName)}=${yearCell})),0)`
}

function dashboardCountClients(sheetName: string) {
  return `=COUNTA(${dashboardMainRange(sheetName, 'I')})`
}

function dashboardCountByStatus(sheetName: string, statusRegex: string) {
  return `=IFERROR(COUNTA(FILTER(${dashboardMainRange(sheetName, 'I')},${dashboardMainRange(sheetName, 'I')}<>"",REGEXMATCH(UPPER(TO_TEXT(${dashboardMainRange(sheetName, 'O')})),"${statusRegex}"))),0)`
}

function dashboardCountByColumnValue(sheetName: string, criteriaColumn: string, criteriaCell: string) {
  return `=COUNTIF(${dashboardMainRange(sheetName, criteriaColumn)},${criteriaCell})`
}

function gridRange(sheetId: number, startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) {
  return {
    sheetId,
    startRowIndex,
    endRowIndex,
    startColumnIndex,
    endColumnIndex,
  }
}

function dashboardPieChartSpec(sheetId: number) {
  return {
    title: 'Clientes por situacao',
    pieChart: {
      legendPosition: 'RIGHT_LEGEND',
      threeDimensional: false,
      domain: {
        sourceRange: {
          sources: [gridRange(sheetId, 9, 15, 1, 2)],
        },
      },
      series: {
        sourceRange: {
          sources: [gridRange(sheetId, 9, 15, 2, 3)],
        },
      },
    },
  }
}

function dashboardMonthlyLineChartSpec(sheetId: number) {
  return {
    title: 'Historico mensal: em atraso x em dia',
    basicChart: {
      chartType: 'LINE',
      legendPosition: 'BOTTOM_LEGEND',
      lineSmoothing: true,
      headerCount: 1,
      axis: [
        { position: 'BOTTOM_AXIS', title: 'Mes' },
        { position: 'LEFT_AXIS', title: 'Quantidade' },
      ],
      domains: [
        {
          domain: {
            sourceRange: {
              sources: [gridRange(sheetId, 48, 69, 1, 2)],
            },
          },
        },
      ],
      series: [
        {
          series: {
            sourceRange: {
              sources: [gridRange(sheetId, 48, 69, 2, 3)],
            },
          },
          targetAxis: 'LEFT_AXIS',
          colorStyle: { rgbColor: hexToGoogleColor('#2563eb') },
        },
        {
          series: {
            sourceRange: {
              sources: [gridRange(sheetId, 48, 69, 3, 4)],
            },
          },
          targetAxis: 'LEFT_AXIS',
          colorStyle: { rgbColor: hexToGoogleColor('#ef4444') },
        },
      ],
    },
  }
}

function dashboardReguaBarChartSpec(sheetId: number) {
  return {
    title: 'Distribuicao da regua de cobranca',
    basicChart: {
      chartType: 'BAR',
      legendPosition: 'NO_LEGEND',
      headerCount: 1,
      axis: [
        { position: 'BOTTOM_AXIS', title: 'Quantidade' },
        { position: 'LEFT_AXIS', title: 'Etapa' },
      ],
      domains: [
        {
          domain: {
            sourceRange: {
              sources: [gridRange(sheetId, 19, 29, 1, 2)],
            },
          },
        },
      ],
      series: [
        {
          series: {
            sourceRange: {
              sources: [gridRange(sheetId, 19, 29, 2, 3)],
            },
          },
          targetAxis: 'BOTTOM_AXIS',
          colorStyle: { rgbColor: hexToGoogleColor('#0ea5e9') },
        },
      ],
    },
  }
}

async function repairDashboard(
  sheets: GoogleSheetsService,
  sheetName: string,
  dryRun: boolean,
): Promise<AutomationResult> {
  const timestamp = buildTimestamp()
  const values = await sheets.readSheetValues(sheetName)
  const processed = Math.max(findLastFilledRow(values) - 1, 0)

  await sheets.ensureRowCapacity(DASHBOARD_SHEET_NAME, 125)
  await sheets.ensureColumnCapacity(DASHBOARD_SHEET_NAME, 14)
  const dashboardProperties = await sheets.getSheetProperties(DASHBOARD_SHEET_NAME)
  const dashboardSheet = quoteSheetName(DASHBOARD_SHEET_NAME)

  const situationRows = [
    ['Em atraso', dashboardCountByStatus(sheetName, 'ATRASO'), dashboardCurrencySumIf(sheetName, 'U', 'ATRASO'), dashboardCurrencySumIf(sheetName, 'V', 'ATRASO'), dashboardCurrencySumIf(sheetName, 'W', 'ATRASO')],
    ['A vencer', dashboardCountByStatus(sheetName, 'A VENCER'), dashboardCurrencySumIf(sheetName, 'U', 'A VENCER'), dashboardCurrencySumIf(sheetName, 'V', 'A VENCER'), dashboardCurrencySumIf(sheetName, 'W', 'A VENCER')],
    ['Pago / quitado', `=${dashboardCountByStatus(sheetName, 'QUITADO').slice(1)}+${dashboardCountByStatus(sheetName, 'PAGO').slice(1)}`, dashboardCurrencySumIf(sheetName, 'U', 'QUITADO|PAGO'), dashboardCurrencySumIf(sheetName, 'V', 'QUITADO|PAGO'), dashboardCurrencySumIf(sheetName, 'W', 'QUITADO|PAGO')],
    ['Rescindido', dashboardCountByStatus(sheetName, 'RESCIND'), dashboardCurrencySumIf(sheetName, 'U', 'RESCIND'), dashboardCurrencySumIf(sheetName, 'V', 'RESCIND'), dashboardCurrencySumIf(sheetName, 'W', 'RESCIND')],
    ['Outros / vazio', '=MAX(0,$B$6-SUM(C11:C14))', '=MAX(0,$F$6-SUM(D11:D14))', '=MAX(0,$H$6-SUM(E11:E14))', '=MAX(0,$J$6-SUM(F11:F14))'],
    ['Total', '=SUM(C11:C15)', '=SUM(D11:D15)', '=SUM(E11:E15)', '=SUM(F11:F15)'],
  ]

  const yearRows = [2022, 2023, 2024, 2025, 2026].map((year, index) => {
    const rowNumber = 11 + index
    return [
      year,
      dashboardCurrencySumByYear(sheetName, 'U', `H${rowNumber}`),
      dashboardCurrencySumByYear(sheetName, 'V', `H${rowNumber}`),
      dashboardCurrencySumByYear(sheetName, 'W', `H${rowNumber}`),
      `=IFERROR(COUNTA(FILTER(${dashboardMainRange(sheetName, 'I')},${dashboardDateYearArray(sheetName)}=H${rowNumber},REGEXMATCH(UPPER(TO_TEXT(${dashboardMainRange(sheetName, 'O')})),"ATRASO"))),0)`,
    ]
  })

  const reguaLabels = [...REGUA_OPTIONS, 'Sem regua']
  const reguaRows = reguaLabels.map((label, index) => {
    const rowNumber = 20 + index
    const stageCell = `B${rowNumber}`
    if (label === 'Sem regua') {
      const missingCondition = `((${dashboardMainRange(sheetName, 'AA')}="")+(${dashboardMainRange(sheetName, 'AA')}="-"))>0`
      return [
        label,
        `=IFERROR(COUNTA(FILTER(${dashboardMainRange(sheetName, 'I')},${dashboardMainRange(sheetName, 'I')}<>"",${missingCondition})),0)`,
        `=IFERROR(COUNTA(FILTER(${dashboardMainRange(sheetName, 'I')},${dashboardMainRange(sheetName, 'X')}="ATIVO",${missingCondition})),0)`,
        `=IFERROR(COUNTA(FILTER(${dashboardMainRange(sheetName, 'I')},${dashboardMainRange(sheetName, 'X')}="INATIVO",${missingCondition})),0)`,
        `=IFERROR(SUM(FILTER(${dashboardCurrencyArray(sheetName, 'U')},${missingCondition})),0)`,
      ]
    }

    return [
      label,
      dashboardCountByColumnValue(sheetName, 'AA', stageCell),
      `=COUNTIFS(${dashboardMainRange(sheetName, 'AA')},${stageCell},${dashboardMainRange(sheetName, 'X')},"ATIVO")`,
      `=COUNTIFS(${dashboardMainRange(sheetName, 'AA')},${stageCell},${dashboardMainRange(sheetName, 'X')},"INATIVO")`,
      dashboardCurrencySumByColumnValue(sheetName, 'U', 'AA', stageCell),
    ]
  })

  const monthlyRows = Array.from({ length: 20 }, (_, index) => {
    const rowNumber = 49 + index
    const monthCell = `B${rowNumber}`
    const monthListFormula = `SORT(UNIQUE(FILTER(${dashboardMonthKeyArray(sheetName)},${dashboardMonthKeyArray(sheetName)}<>"")),1,FALSE)`
    return [
      `=IFERROR(INDEX(${monthListFormula},${index + 1}),"")`,
      `=IF(${monthCell}="","",IFERROR(COUNTA(FILTER(${dashboardMainRange(sheetName, 'I')},${dashboardMonthKeyArray(sheetName)}=${monthCell},REGEXMATCH(UPPER(TO_TEXT(${dashboardMainRange(sheetName, 'O')})),"ATRASO"))),0))`,
      `=IF(${monthCell}="","",IFERROR(COUNTA(FILTER(${dashboardMainRange(sheetName, 'I')},${dashboardMonthKeyArray(sheetName)}=${monthCell},REGEXMATCH(UPPER(TO_TEXT(${dashboardMainRange(sheetName, 'O')})),"EM DIA"))),0))`,
      `=IF(${monthCell}="","",C${rowNumber}-D${rowNumber})`,
    ]
  })

  const weeklyRows = ['Inadimplentes', 'Lembrete de Atraso', 'Aviso de Inadimplencia', 'Negociacao', 'Notificacao', 'Execucao', 'Rescisao'].map((label, index) => {
    const rowNumber = 49 + index
    const stageLabel = label === 'Inadimplentes' ? 'PENDENTE' : label
    return [
      label,
      `=COUNTIF(${dashboardMainRange(sheetName, 'AA')},"${stageLabel}")`,
      `=IFERROR(LOOKUP(2,1/(${quoteSheetName(DASHBOARD_HISTORY_SHEET_NAME)}!A2:A<>""),INDEX(${quoteSheetName(DASHBOARD_HISTORY_SHEET_NAME)}!B:H,,${index + 1})),0)`,
      `=I${rowNumber}-J${rowNumber}`,
    ]
  })

  const matterRows = Array.from({ length: 8 }, (_, index) => {
    const rowNumber = 31 + index
    const matterListFormula = `SORT(UNIQUE(FILTER(${dashboardMainRange(sheetName, 'J')},${dashboardMainRange(sheetName, 'J')}<>"")),1,TRUE)`
    return [
      `=IFERROR(INDEX(${matterListFormula},${index + 1}),"")`,
      `=IF(B${rowNumber}="","",COUNTIF(${dashboardMainRange(sheetName, 'J')},B${rowNumber}))`,
      `=IF(C${rowNumber}=0,"",SPARKLINE(C${rowNumber},{"charttype","bar";"max",MAX($C$31:$C$38)}))`,
      `=IF(B${rowNumber}="","",${dashboardCurrencySumByColumnValue(sheetName, 'U', 'J', `B${rowNumber}`)})`,
    ]
  })

  const stageDistributionRows = reguaRows.slice(0, 8).map((row, index) => {
    const rowNumber = 31 + index
    return [
      row[0],
      `=C${20 + index}`,
      `=IF(I${rowNumber}=0,"",SPARKLINE(I${rowNumber},{"charttype","bar";"max",MAX($I$31:$I$38)}))`,
      `=F${20 + index}`,
    ]
  })

  if (!dryRun) {
    await sheets.batchUpdateValues([
      {
        range: `${dashboardSheet}!B6:N6`,
        values: [[
          dashboardCountClients(sheetName),
          '',
          dashboardCountByStatus(sheetName, 'ATRASO'),
          '',
          dashboardCurrencySum(sheetName, 'U'),
          '',
          `=${dashboardCountByStatus(sheetName, 'QUITADO').slice(1)}+${dashboardCountByStatus(sheetName, 'PAGO').slice(1)}`,
          '',
          dashboardCurrencySum(sheetName, 'W'),
          '',
          '=IFERROR(MAX(FILTER(' + dashboardMainRange(sheetName, 'AF') + ',' + dashboardMainRange(sheetName, 'AF') + '<>"")),"")',
          '',
          '',
        ]],
      },
      {
        range: `${dashboardSheet}!B10:F16`,
        values: [['Situacao', 'Qtd', 'Valor aberto', 'Valor pago', 'Valor a vencer'], ...situationRows],
      },
      {
        range: `${dashboardSheet}!H10:L16`,
        values: [['Ano', 'Valor aberto', 'Valor pago', 'Valor a vencer', 'Em atraso'], ...yearRows, ['Total', '=SUM(I11:I15)', '=SUM(J11:J15)', '=SUM(K11:K15)', '=SUM(L11:L15)']],
      },
      {
        range: `${dashboardSheet}!B20:F30`,
        values: [['Etapa', 'Qtd', 'Ativos', 'Inativos', 'Valor aberto'], ...reguaRows],
      },
      {
        range: `${dashboardSheet}!H20:I25`,
        values: [
          ['Indicador', 'Valor'],
          ['Sem atualizacao hoje', `=COUNTIFS(${dashboardMainRange(sheetName, 'AF')},">="&TODAY(),${dashboardMainRange(sheetName, 'AF')},"<"&TODAY()+1)`],
          ['Clientes sem regua', '=C29'],
          ['Em atraso sem acao', `=COUNTIFS(${dashboardMainRange(sheetName, 'O')},"*ATRASO*",${dashboardMainRange(sheetName, 'AA')},"") + COUNTIFS(${dashboardMainRange(sheetName, 'O')},"*ATRASO*",${dashboardMainRange(sheetName, 'AA')},"-")`],
          ['Dias vencido medio', `=IFERROR(AVERAGE(FILTER(${dashboardMainRange(sheetName, 'Y')},${dashboardMainRange(sheetName, 'Y')}>0)),0)`],
          ['Maior atraso', `=IFERROR(MAX(${dashboardMainRange(sheetName, 'Y')}),0)`],
        ],
      },
      {
        range: `${dashboardSheet}!B30:E38`,
        values: [['Materia', 'Casos', 'Grafico', 'Valor aberto'], ...matterRows],
      },
      {
        range: `${dashboardSheet}!H30:K38`,
        values: [['Etapa', 'Casos', 'Grafico', 'Valor aberto'], ...stageDistributionRows],
      },
      {
        range: `${dashboardSheet}!B49:E69`,
        values: [['Mes', 'Em atraso', 'Em dia', 'Delta atraso'], ...monthlyRows],
      },
      {
        range: `${dashboardSheet}!H49:K56`,
        values: [['Etapa', 'Atual', 'Ultima medicao', 'Delta'], ...weeklyRows],
      },
    ])

    const dashboardCellRange = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) =>
      gridRange(dashboardProperties.sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex)
    const background = (hex: string) => ({ backgroundColorStyle: { rgbColor: hexToGoogleColor(hex) } })
    const textColor = (hex: string) => ({ foregroundColorStyle: { rgbColor: hexToGoogleColor(hex) } })
    const repeatCell = (
      range: ReturnType<typeof dashboardCellRange>,
      userEnteredFormat: Record<string, unknown>,
      fields: string,
    ) => ({ repeatCell: { range, cell: { userEnteredFormat }, fields } })
    const mergeRange = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) => ({
      mergeCells: {
        range: dashboardCellRange(startRowIndex, endRowIndex, startColumnIndex, endColumnIndex),
        mergeType: 'MERGE_ALL',
      },
    })
    const sectionTitleRanges = [
      dashboardCellRange(8, 9, 1, 6),
      dashboardCellRange(8, 9, 7, 12),
      dashboardCellRange(17, 18, 1, 6),
      dashboardCellRange(17, 18, 7, 9),
      dashboardCellRange(29, 30, 1, 5),
      dashboardCellRange(29, 30, 7, 11),
      dashboardCellRange(47, 48, 1, 5),
      dashboardCellRange(47, 48, 7, 11),
    ]
    const tableHeaderRanges = [
      dashboardCellRange(9, 10, 1, 6),
      dashboardCellRange(9, 10, 7, 12),
      dashboardCellRange(18, 19, 1, 6),
      dashboardCellRange(18, 19, 7, 9),
      dashboardCellRange(30, 31, 1, 5),
      dashboardCellRange(30, 31, 7, 11),
      dashboardCellRange(48, 49, 1, 5),
      dashboardCellRange(48, 49, 7, 11),
    ]
    const moneyRanges = [
      dashboardCellRange(5, 6, 5, 6),
      dashboardCellRange(5, 6, 9, 10),
      dashboardCellRange(10, 16, 3, 6),
      dashboardCellRange(10, 16, 8, 11),
      dashboardCellRange(19, 29, 5, 6),
      dashboardCellRange(31, 39, 4, 5),
      dashboardCellRange(31, 39, 10, 11),
    ]
    const dashboardFormatRequests = [
      repeatCell(
        dashboardCellRange(0, 110, 0, 12),
        { ...background('#eaf2ff'), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', textFormat: { fontFamily: 'Cambria', fontSize: 10 } },
        'userEnteredFormat(backgroundColorStyle,horizontalAlignment,verticalAlignment,textFormat)',
      ),
      repeatCell(
        dashboardCellRange(0, 3, 1, 12),
        { ...background('#0f172a'), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', textFormat: { ...textColor('#ffffff'), bold: true, fontFamily: 'Cambria', fontSize: 12 } },
        'userEnteredFormat(backgroundColorStyle,horizontalAlignment,verticalAlignment,textFormat)',
      ),
      repeatCell(
        dashboardCellRange(0, 1, 1, 12),
        { textFormat: { ...textColor('#ffffff'), bold: true, fontFamily: 'Cambria', fontSize: 18 } },
        'userEnteredFormat(textFormat)',
      ),
      repeatCell(
        dashboardCellRange(4, 5, 1, 12),
        { ...background('#9bbcf0'), horizontalAlignment: 'CENTER', textFormat: { bold: true, fontFamily: 'Cambria', fontSize: 10 } },
        'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
      ),
      repeatCell(
        dashboardCellRange(5, 6, 1, 12),
        { ...background('#f8fafc'), horizontalAlignment: 'CENTER', textFormat: { bold: true, fontFamily: 'Cambria', fontSize: 12 } },
        'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
      ),
      ...sectionTitleRanges.map((range) =>
        repeatCell(
          range,
          { ...background('#1f4e8c'), horizontalAlignment: 'CENTER', textFormat: { ...textColor('#ffffff'), bold: true, fontFamily: 'Cambria', fontSize: 12 } },
          'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
        ),
      ),
      ...tableHeaderRanges.map((range) =>
        repeatCell(
          range,
          { ...background('#a9c7f5'), horizontalAlignment: 'CENTER', textFormat: { bold: true, fontFamily: 'Cambria', fontSize: 10 } },
          'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
        ),
      ),
      ...moneyRanges.map((range) =>
        repeatCell(
          range,
          { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } },
          'userEnteredFormat.numberFormat',
        ),
      ),
      ...[
        dashboardCellRange(5, 6, 1, 2),
        dashboardCellRange(5, 6, 3, 4),
        dashboardCellRange(5, 6, 7, 8),
      ].map((range) =>
        repeatCell(
          range,
          { numberFormat: { type: 'NUMBER', pattern: '#,##0' } },
          'userEnteredFormat.numberFormat',
        ),
      ),
      repeatCell(
        dashboardCellRange(5, 6, 11, 12),
        { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
        'userEnteredFormat.numberFormat',
      ),
      mergeRange(0, 1, 1, 12),
      mergeRange(1, 2, 1, 12),
      mergeRange(2, 3, 1, 12),
      mergeRange(8, 9, 1, 6),
      mergeRange(8, 9, 7, 12),
      mergeRange(17, 18, 1, 6),
      mergeRange(17, 18, 7, 9),
      mergeRange(29, 30, 1, 5),
      mergeRange(29, 30, 7, 11),
      mergeRange(47, 48, 1, 5),
      mergeRange(47, 48, 7, 11),
    ]

    await sheets.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: dashboardFormatRequests }),
    })

    const metadata = await sheets.request('?fields=sheets(properties(sheetId,title),charts(chartId))')
    const dashboardSheetMetadata = (metadata.sheets || []).find(
      (sheet: { properties?: { title?: string } }) => sheet.properties?.title === DASHBOARD_SHEET_NAME,
    )
    const chartRequests = [
      ...((dashboardSheetMetadata?.charts || []) as Array<{ chartId?: number }>)
        .filter((chart) => chart.chartId !== undefined)
        .map((chart) => ({ deleteEmbeddedObject: { objectId: chart.chartId } })),
      {
        addChart: {
          chart: {
            spec: dashboardPieChartSpec(dashboardProperties.sheetId),
            position: {
              overlayPosition: {
                anchorCell: { sheetId: dashboardProperties.sheetId, rowIndex: 71, columnIndex: 1 },
                offsetXPixels: 10,
                offsetYPixels: 8,
                widthPixels: 440,
                heightPixels: 300,
              },
            },
          },
        },
      },
      {
        addChart: {
          chart: {
            spec: dashboardMonthlyLineChartSpec(dashboardProperties.sheetId),
            position: {
              overlayPosition: {
                anchorCell: { sheetId: dashboardProperties.sheetId, rowIndex: 71, columnIndex: 6 },
                offsetXPixels: 10,
                offsetYPixels: 8,
                widthPixels: 560,
                heightPixels: 320,
              },
            },
          },
        },
      },
      {
        addChart: {
          chart: {
            spec: dashboardReguaBarChartSpec(dashboardProperties.sheetId),
            position: {
              overlayPosition: {
                anchorCell: { sheetId: dashboardProperties.sheetId, rowIndex: 92, columnIndex: 1 },
                offsetXPixels: 10,
                offsetYPixels: 8,
                widthPixels: 760,
                heightPixels: 320,
              },
            },
          },
        },
      },
    ]

    await sheets.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: chartRequests }),
    })
  }

  return {
    dryRun,
    sheetName,
    pdfFileName: '',
    timestamp,
    startRow: 2,
    processed,
    skipped: 0,
    matched: 0,
    updated: dryRun ? 0 : 1,
    refreshed: 0,
    ignored: 0,
    notFound: 0,
    errors: 0,
    updatedCells: dryRun ? 0 : 1,
    logRows: 0,
    preview: [
      {
        rowNumber: null,
        clientName: DASHBOARD_SHEET_NAME,
        action: dryRun ? 'Previa do dashboard' : 'Dashboard corrigido',
        status: 'dashboard_atualizado',
        sources: ['Google Sheets'],
        errorMessage: '',
        cardUrl: '',
      },
    ],
    pendingCount: 0,
    pendingSelections: [],
    dashboard: {
      created: 0,
      updated: dryRun ? 0 : 1,
      refreshed: 0,
      pending: 0,
      notFound: 0,
      errors: 0,
      matched: 0,
      processed,
      financial: {
        openAmount: 0,
        paidAmount: 0,
        upcomingAmount: 0,
      },
      stageBreakdown: [],
      recordStatusBreakdown: [],
      actionBreakdown: [],
    },
  }
}

async function applyDashboardModernLayout(sheets: GoogleSheetsService, sheetId: number) {
  const cellRange = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) =>
    gridRange(sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex)
  const background = (hex: string) => ({ backgroundColorStyle: { rgbColor: hexToGoogleColor(hex) } })
  const textColor = (hex: string) => ({ foregroundColorStyle: { rgbColor: hexToGoogleColor(hex) } })
  const repeatCell = (
    range: ReturnType<typeof cellRange>,
    userEnteredFormat: Record<string, unknown>,
    fields: string,
  ) => ({ repeatCell: { range, cell: { userEnteredFormat }, fields } })
  const mergeRange = (startRowIndex: number, endRowIndex: number, startColumnIndex: number, endColumnIndex: number) => ({
    mergeCells: {
      range: cellRange(startRowIndex, endRowIndex, startColumnIndex, endColumnIndex),
      mergeType: 'MERGE_ALL',
    },
  })
  const sectionTitleRanges = [
    cellRange(8, 9, 1, 6),
    cellRange(8, 9, 7, 12),
    cellRange(17, 18, 1, 6),
    cellRange(17, 18, 7, 9),
    cellRange(29, 30, 1, 5),
    cellRange(29, 30, 7, 11),
    cellRange(47, 48, 1, 5),
    cellRange(47, 48, 7, 11),
  ]
  const tableHeaderRanges = [
    cellRange(9, 10, 1, 6),
    cellRange(9, 10, 7, 12),
    cellRange(18, 19, 1, 6),
    cellRange(18, 19, 7, 9),
    cellRange(30, 31, 1, 5),
    cellRange(30, 31, 7, 11),
    cellRange(48, 49, 1, 5),
    cellRange(48, 49, 7, 11),
  ]
  const moneyRanges = [
    cellRange(5, 6, 5, 6),
    cellRange(5, 6, 9, 10),
    cellRange(10, 16, 3, 6),
    cellRange(10, 16, 8, 11),
    cellRange(19, 29, 5, 6),
    cellRange(31, 39, 4, 5),
    cellRange(31, 39, 10, 11),
  ]

  await sheets.request(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        repeatCell(
          cellRange(0, 110, 0, 12),
          { ...background('#eaf2ff'), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', textFormat: { fontFamily: 'Cambria', fontSize: 10 } },
          'userEnteredFormat(backgroundColorStyle,horizontalAlignment,verticalAlignment,textFormat)',
        ),
        repeatCell(
          cellRange(0, 3, 1, 12),
          { ...background('#0f172a'), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', textFormat: { ...textColor('#ffffff'), bold: true, fontFamily: 'Cambria', fontSize: 12 } },
          'userEnteredFormat(backgroundColorStyle,horizontalAlignment,verticalAlignment,textFormat)',
        ),
        repeatCell(
          cellRange(0, 1, 1, 12),
          { textFormat: { ...textColor('#ffffff'), bold: true, fontFamily: 'Cambria', fontSize: 18 } },
          'userEnteredFormat(textFormat)',
        ),
        repeatCell(
          cellRange(4, 5, 1, 12),
          { ...background('#9bbcf0'), horizontalAlignment: 'CENTER', textFormat: { bold: true, fontFamily: 'Cambria', fontSize: 10 } },
          'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
        ),
        repeatCell(
          cellRange(5, 6, 1, 12),
          { ...background('#f8fafc'), horizontalAlignment: 'CENTER', textFormat: { bold: true, fontFamily: 'Cambria', fontSize: 12 } },
          'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
        ),
        ...sectionTitleRanges.map((range) =>
          repeatCell(
            range,
            { ...background('#1f4e8c'), horizontalAlignment: 'CENTER', textFormat: { ...textColor('#ffffff'), bold: true, fontFamily: 'Cambria', fontSize: 12 } },
            'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
          ),
        ),
        ...tableHeaderRanges.map((range) =>
          repeatCell(
            range,
            { ...background('#a9c7f5'), horizontalAlignment: 'CENTER', textFormat: { bold: true, fontFamily: 'Cambria', fontSize: 10 } },
            'userEnteredFormat(backgroundColorStyle,horizontalAlignment,textFormat)',
          ),
        ),
        ...moneyRanges.map((range) =>
          repeatCell(
            range,
            { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } },
            'userEnteredFormat.numberFormat',
          ),
        ),
        ...[
          cellRange(5, 6, 1, 2),
          cellRange(5, 6, 3, 4),
          cellRange(5, 6, 7, 8),
        ].map((range) =>
          repeatCell(
            range,
            { numberFormat: { type: 'NUMBER', pattern: '#,##0' } },
            'userEnteredFormat.numberFormat',
          ),
        ),
        repeatCell(
          cellRange(5, 6, 11, 12),
          { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
          'userEnteredFormat.numberFormat',
        ),
        mergeRange(0, 1, 1, 12),
        mergeRange(1, 2, 1, 12),
        mergeRange(2, 3, 1, 12),
        mergeRange(8, 9, 1, 6),
        mergeRange(8, 9, 7, 12),
        mergeRange(17, 18, 1, 6),
        mergeRange(17, 18, 7, 9),
        mergeRange(29, 30, 1, 5),
        mergeRange(29, 30, 7, 11),
        mergeRange(47, 48, 1, 5),
        mergeRange(47, 48, 7, 11),
      ],
    }),
  })
}

async function repairDashboardValues(
  sheets: GoogleSheetsService,
  sheetName: string,
  dryRun: boolean,
): Promise<AutomationResult> {
  const timestamp = buildTimestamp()
  const values = await sheets.readSheetValues(sheetName)
  const dataRows = values.slice(1).filter((row) => isClientDataRow(row || []))
  const processed = dataRows.length

  await sheets.ensureRowCapacity(DASHBOARD_SHEET_NAME, 125)
  await sheets.ensureColumnCapacity(DASHBOARD_SHEET_NAME, 14)
  const dashboardProperties = await sheets.getSheetProperties(DASHBOARD_SHEET_NAME)
  const dashboardSheet = quoteSheetName(DASHBOARD_SHEET_NAME)

  const createMetric = () => ({
    count: 0,
    openAmount: 0,
    paidAmount: 0,
    upcomingAmount: 0,
    active: 0,
    inactive: 0,
  })

  const addMetricAmounts = (metric: ReturnType<typeof createMetric>, row: SheetCellValue[]) => {
    metric.count += 1
    metric.openAmount += parseAmount(getCell(row, 21)) || 0
    metric.paidAmount += parseAmount(getCell(row, 22)) || 0
    metric.upcomingAmount += parseAmount(getCell(row, 23)) || 0
    const recordStatus = normalizeHeader(getCell(row, 24))
    if (recordStatus === 'INATIVO') {
      metric.inactive += 1
    } else {
      metric.active += 1
    }
  }

  const situationLabels = ['Em atraso', 'A vencer', 'Pago / quitado', 'Rescindido', 'Outros / vazio']
  const situationMetrics = new Map(situationLabels.map((label) => [label, createMetric()]))
  const yearMetrics = new Map<number, ReturnType<typeof createMetric>>()
  const reguaLabels = [...REGUA_OPTIONS, 'Sem regua']
  const reguaMetrics = new Map(reguaLabels.map((label) => [label, createMetric()]))
  const monthMetrics = new Map<string, { overdue: number; onTime: number }>()
  const matterMetrics = new Map<string, ReturnType<typeof createMetric>>()

  let latestUpdateDate: Date | null = null
  let updatedToday = 0
  let overdueWithoutAction = 0
  let overdueDaysTotal = 0
  let overdueDaysCount = 0
  let maxOverdueDays = 0
  const todayText = buildCurrentDate()

  for (const rawRow of dataRows) {
    const row = normalizeSheetRowLength(rawRow || [], TARGET_END_COLUMN_INDEX)
    const financialStatus = normalizeHeader(getCell(row, 15))
    const stage = getCell(row, 27)
    const stageKey = stage && stage !== '-' ? stage : 'Sem regua'
    const recordDate = parseBrDate(getCell(row, 1))
    const matter = getCell(row, 10) || 'Sem materia'
    const updateDate = parseBrDate(getCell(row, 32))
    const daysOverdue = Number(getCell(row, 25))

    let situation = 'Outros / vazio'
    if (financialStatus.includes('ATRAS')) {
      situation = 'Em atraso'
    } else if (financialStatus.includes('VENCER')) {
      situation = 'A vencer'
    } else if (financialStatus.includes('QUITADO') || financialStatus.includes('PAGO')) {
      situation = 'Pago / quitado'
    } else if (financialStatus.includes('RESCIND')) {
      situation = 'Rescindido'
    }

    addMetricAmounts(situationMetrics.get(situation) || situationMetrics.get('Outros / vazio')!, row)

    if (recordDate) {
      const year = recordDate.getFullYear()
      if (!yearMetrics.has(year)) yearMetrics.set(year, createMetric())
      addMetricAmounts(yearMetrics.get(year)!, row)

      const monthKey = `${recordDate.getFullYear()}/${String(recordDate.getMonth() + 1).padStart(2, '0')}`
      const monthMetric = monthMetrics.get(monthKey) || { overdue: 0, onTime: 0 }
      if (financialStatus.includes('ATRAS')) monthMetric.overdue += 1
      if (financialStatus.includes('DIA')) monthMetric.onTime += 1
      monthMetrics.set(monthKey, monthMetric)
    }

    const resolvedStageKey = reguaMetrics.has(stageKey) ? stageKey : 'Sem regua'
    addMetricAmounts(reguaMetrics.get(resolvedStageKey)!, row)

    if (!matterMetrics.has(matter)) matterMetrics.set(matter, createMetric())
    addMetricAmounts(matterMetrics.get(matter)!, row)

    if (getCell(row, 32) === todayText) updatedToday += 1
    if (updateDate && (!latestUpdateDate || updateDate > latestUpdateDate)) latestUpdateDate = updateDate
    if (financialStatus.includes('ATRAS') && (!stage || stage === '-')) overdueWithoutAction += 1
    if (Number.isFinite(daysOverdue) && daysOverdue > 0) {
      overdueDaysTotal += daysOverdue
      overdueDaysCount += 1
      maxOverdueDays = Math.max(maxOverdueDays, daysOverdue)
    }
  }

  const metricToRow = (label: string, metric: ReturnType<typeof createMetric>) => [
    label,
    metric.count,
    metric.openAmount,
    metric.paidAmount,
    metric.upcomingAmount,
  ]

  const totalMetric = createMetric()
  for (const metric of situationMetrics.values()) {
    totalMetric.count += metric.count
    totalMetric.openAmount += metric.openAmount
    totalMetric.paidAmount += metric.paidAmount
    totalMetric.upcomingAmount += metric.upcomingAmount
  }

  const situationRows = [
    ...situationLabels.map((label) => metricToRow(label, situationMetrics.get(label)!)),
    metricToRow('Total', totalMetric),
  ]

  const yearRows = [2022, 2023, 2024, 2025, 2026].map((year) => {
    const metric = yearMetrics.get(year) || createMetric()
    const overdueCount = dataRows.filter((row) => {
      const date = parseBrDate(getCell(row, 1))
      return date?.getFullYear() === year && normalizeHeader(getCell(row, 15)).includes('ATRAS')
    }).length
    return [year, metric.openAmount, metric.paidAmount, metric.upcomingAmount, overdueCount]
  })
  const totalYearRow = [
    'Total',
    yearRows.reduce((sum, row) => sum + Number(row[1] || 0), 0),
    yearRows.reduce((sum, row) => sum + Number(row[2] || 0), 0),
    yearRows.reduce((sum, row) => sum + Number(row[3] || 0), 0),
    yearRows.reduce((sum, row) => sum + Number(row[4] || 0), 0),
  ]

  const reguaRows = reguaLabels.map((label) => {
    const metric = reguaMetrics.get(label) || createMetric()
    return [label, metric.count, metric.active, metric.inactive, metric.openAmount]
  })

  const monthlyRows = [...monthMetrics.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 20)
    .map(([month, metric]) => [month, metric.overdue, metric.onTime, metric.overdue - metric.onTime])
  while (monthlyRows.length < 20) monthlyRows.push(['', 0, 0, 0])

  const historyValues = await sheets.readSheetValues(DASHBOARD_HISTORY_SHEET_NAME).catch(() => [])
  const lastHistoryRow = [...historyValues].reverse().find((row) => getCell(row || [], 1))
  const weeklyStages = [
    { label: 'Inadimplentes', stage: 'PENDENTE' },
    { label: REGUA_OPTIONS[1], stage: REGUA_OPTIONS[1] },
    { label: REGUA_OPTIONS[0], stage: REGUA_OPTIONS[0] },
    { label: REGUA_OPTIONS[2], stage: REGUA_OPTIONS[2] },
    { label: REGUA_OPTIONS[4], stage: REGUA_OPTIONS[4] },
    { label: REGUA_OPTIONS[6], stage: REGUA_OPTIONS[6] },
    { label: REGUA_OPTIONS[3], stage: REGUA_OPTIONS[3] },
  ]
  const weeklyRows = weeklyStages.map((item, index) => {
    const current = (reguaMetrics.get(item.stage) || createMetric()).count
    const last = parseAmount(lastHistoryRow?.[index + 1]) || 0
    return [item.label, current, last, current - last]
  })

  const buildBar = (value: number, max: number) => {
    if (!value || !max) return ''
    return '|'.repeat(Math.max(1, Math.round((value / max) * 20)))
  }
  const matterEntries = [...matterMetrics.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 8)
  const maxMatterCount = Math.max(...matterEntries.map(([, metric]) => metric.count), 0)
  const matterRows = matterEntries.map(([label, metric]) => [
    label,
    metric.count,
    buildBar(metric.count, maxMatterCount),
    metric.openAmount,
  ])
  while (matterRows.length < 8) matterRows.push(['', 0, '', 0])

  const stageDistributionEntries = reguaRows.slice(0, 8)
  const maxStageCount = Math.max(...stageDistributionEntries.map((row) => Number(row[1] || 0)), 0)
  const stageDistributionRows = stageDistributionEntries.map((row) => [
    row[0],
    row[1],
    buildBar(Number(row[1] || 0), maxStageCount),
    row[4],
  ])

  const totalOpenAmount = totalMetric.openAmount
  const totalPaidAmount = totalMetric.paidAmount
  const totalUpcomingAmount = totalMetric.upcomingAmount
  const overdueMetric = situationMetrics.get('Em atraso') || createMetric()
  const paidMetric = situationMetrics.get('Pago / quitado') || createMetric()
  const emptyDashboardRow = (length: number) => Array.from({ length }, () => '')
  const titleTail = emptyDashboardRow(10)

  if (!dryRun) {
    await sheets.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            unmergeCells: {
              range: {
                sheetId: dashboardProperties.sheetId,
                startRowIndex: 0,
                endRowIndex: 125,
                startColumnIndex: 0,
                endColumnIndex: 20,
              },
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId: dashboardProperties.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
              properties: { pixelSize: 34 },
              fields: 'pixelSize',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId: dashboardProperties.sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
              properties: { pixelSize: 170 },
              fields: 'pixelSize',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId: dashboardProperties.sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 6 },
              properties: { pixelSize: 120 },
              fields: 'pixelSize',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId: dashboardProperties.sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 },
              properties: { pixelSize: 28 },
              fields: 'pixelSize',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId: dashboardProperties.sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 12 },
              properties: { pixelSize: 135 },
              fields: 'pixelSize',
            },
          },
        ],
      }),
    })

    await sheets.request('/values:batchClear', {
      method: 'POST',
      body: JSON.stringify({
        ranges: [
          `${dashboardSheet}!A1:T125`,
        ],
      }),
    })

    await sheets.batchUpdateValues([
      {
        range: `${dashboardSheet}!B1:L3`,
        values: [
          ['Dashboard Financeiro | Indicador', ...titleTail],
          ['Visão executiva de inadimplência, recebimentos e régua de cobrança', ...titleTail],
          [`Atualizado automaticamente pela base ${sheetName} em ${timestamp}`, ...titleTail],
        ],
      },
      {
        range: `${dashboardSheet}!B5:L6`,
        values: [
          ['Clientes na base', '', 'Em atraso', '', 'Valor em aberto', '', 'Pagos / quitados', '', 'A vencer', '', 'Última atualização'],
          [processed, '', overdueMetric.count, '', totalOpenAmount, '', paidMetric.count, '', totalUpcomingAmount, '', latestUpdateDate ? formatBrDate(latestUpdateDate) : ''],
        ],
      },
      {
        range: `${dashboardSheet}!B9:L9`,
        values: [['Resumo por situação', '', '', '', '', '', 'Resumo por ano', '', '', '', '']],
      },
      {
        range: `${dashboardSheet}!B18:I18`,
        values: [['Régua de cobrança', '', '', '', '', '', 'Acompanhamento operacional']],
      },
      {
        range: `${dashboardSheet}!B30:K30`,
        values: [['Visão de carteira: matérias e valores', '', '', '', '', '', 'Distribuição da régua de cobrança', '', '', '']],
      },
      {
        range: `${dashboardSheet}!B48:K48`,
        values: [['Histórico mensal: em atraso x em dia', '', '', '', '', '', 'Evolução semanal da régua', '', '', '']],
      },
      {
        range: `${dashboardSheet}!B10:F16`,
        values: [['Situação', 'Qtd', 'Valor aberto', 'Valor pago', 'Valor a vencer'], ...situationRows],
      },
      {
        range: `${dashboardSheet}!H10:L16`,
        values: [['Ano', 'Valor aberto', 'Valor pago', 'Valor a vencer', 'Em atraso'], ...yearRows, totalYearRow],
      },
      {
        range: `${dashboardSheet}!B19:F29`,
        values: [['Etapa', 'Qtd', 'Ativos', 'Inativos', 'Valor aberto'], ...reguaRows],
      },
      {
        range: `${dashboardSheet}!H19:I24`,
        values: [
          ['Indicador', 'Valor'],
          ['Sem atualização hoje', Math.max(0, processed - updatedToday)],
          ['Clientes sem regua', (reguaMetrics.get('Sem regua') || createMetric()).count],
          ['Em atraso sem ação', overdueWithoutAction],
          ['Dias vencido medio', overdueDaysCount ? overdueDaysTotal / overdueDaysCount : 0],
          ['Maior atraso', maxOverdueDays],
        ],
      },
      {
        range: `${dashboardSheet}!B31:E39`,
        values: [['Matéria', 'Casos', 'Gráfico', 'Valor aberto'], ...matterRows],
      },
      {
        range: `${dashboardSheet}!H31:K39`,
        values: [['Etapa', 'Casos', 'Gráfico', 'Valor aberto'], ...stageDistributionRows],
      },
      {
        range: `${dashboardSheet}!B49:E69`,
        values: [['Mês', 'Em atraso', 'Em dia', 'Delta atraso'], ...monthlyRows],
      },
      {
        range: `${dashboardSheet}!H49:K56`,
        values: [['Etapa', 'Atual', 'Última medição', 'Delta'], ...weeklyRows],
      },
    ])

    await applyDashboardModernLayout(sheets, dashboardProperties.sheetId)

    const metadata = await sheets.request('?fields=sheets(properties(sheetId,title),charts(chartId))')
    const dashboardSheetMetadata = (metadata.sheets || []).find(
      (sheet: { properties?: { title?: string } }) => sheet.properties?.title === DASHBOARD_SHEET_NAME,
    )
    const chartRequests = [
      ...((dashboardSheetMetadata?.charts || []) as Array<{ chartId?: number }>)
        .filter((chart) => chart.chartId !== undefined)
        .map((chart) => ({ deleteEmbeddedObject: { objectId: chart.chartId } })),
      {
        addChart: {
          chart: {
            spec: dashboardPieChartSpec(dashboardProperties.sheetId),
            position: {
              overlayPosition: {
                anchorCell: { sheetId: dashboardProperties.sheetId, rowIndex: 71, columnIndex: 1 },
                offsetXPixels: 10,
                offsetYPixels: 8,
                widthPixels: 440,
                heightPixels: 300,
              },
            },
          },
        },
      },
      {
        addChart: {
          chart: {
            spec: dashboardMonthlyLineChartSpec(dashboardProperties.sheetId),
            position: {
              overlayPosition: {
                anchorCell: { sheetId: dashboardProperties.sheetId, rowIndex: 71, columnIndex: 6 },
                offsetXPixels: 10,
                offsetYPixels: 8,
                widthPixels: 560,
                heightPixels: 320,
              },
            },
          },
        },
      },
      {
        addChart: {
          chart: {
            spec: dashboardReguaBarChartSpec(dashboardProperties.sheetId),
            position: {
              overlayPosition: {
                anchorCell: { sheetId: dashboardProperties.sheetId, rowIndex: 92, columnIndex: 1 },
                offsetXPixels: 10,
                offsetYPixels: 8,
                widthPixels: 760,
                heightPixels: 320,
              },
            },
          },
        },
      },
    ]

    await sheets.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: chartRequests }),
    })
  }

  return {
    dryRun,
    sheetName,
    pdfFileName: '',
    timestamp,
    startRow: 2,
    processed,
    skipped: 0,
    matched: 0,
    updated: dryRun ? 0 : 1,
    refreshed: 0,
    ignored: 0,
    notFound: 0,
    errors: 0,
    updatedCells: dryRun ? 0 : 1,
    logRows: 0,
    preview: [
      {
        rowNumber: null,
        clientName: DASHBOARD_SHEET_NAME,
        action: dryRun ? 'Previa do dashboard' : 'Dashboard corrigido',
        status: 'dashboard_atualizado',
        sources: ['Google Sheets'],
        errorMessage: '',
        cardUrl: '',
      },
    ],
    pendingCount: 0,
    pendingSelections: [],
    dashboard: {
      created: 0,
      updated: dryRun ? 0 : 1,
      refreshed: 0,
      pending: 0,
      notFound: 0,
      errors: 0,
      matched: 0,
      processed,
      financial: {
        openAmount: totalOpenAmount,
        paidAmount: totalPaidAmount,
        upcomingAmount: totalUpcomingAmount,
      },
      stageBreakdown: [],
      recordStatusBreakdown: [],
      actionBreakdown: [],
    },
  }
}

async function runAutomation(req: Request): Promise<AutomationResult> {
  await assertCanRun(req)

  const body = (await req.json().catch(() => ({}))) as AutomationBody
  const dryRun = Boolean(body.dryRun)
  const spreadsheetId = Deno.env.get('GOOGLE_SPREADSHEET_ID')
  const sheetName = String(body.sheetName || Deno.env.get('GOOGLE_SHEET_NAME') || 'Externos')
  const parsedMaxRows = Number(body.maxRows)
  const parsedStartRow = Number(body.startRow)
  const maxRows = Number.isFinite(parsedMaxRows) && parsedMaxRows > 0 ? parsedMaxRows : 0
  const startRow = Number.isFinite(parsedStartRow) && parsedStartRow >= 2 ? parsedStartRow : 2
  const pdfRecords = Array.isArray(body.pdfRecords) ? body.pdfRecords : []
  const clearLog = body.clearLog !== false
  const normalizeLayout = body.normalizeLayout === true
  const selectedProcessMatches = normalizeSelectedProcessMatches(body.selectedProcessMatches)
  const allowFallbackSelections = body.allowFallbackSelections === true

  if (!spreadsheetId) {
    throw new Error('Variavel obrigatoria ausente: GOOGLE_SPREADSHEET_ID')
  }

  const accessToken = await getGoogleAccessToken()
  const sheets = new GoogleSheetsService(spreadsheetId, accessToken)
  await sheets.ensureColumnCapacity(sheetName, TARGET_END_COLUMN_INDEX)
  await sheets.ensureLogSheet()

  if (body.maintenanceAction === 'normalize_months') {
    return normalizeMonthlySheetLayout(sheets, sheetName, dryRun)
  }

  if (body.maintenanceAction === 'repair_dashboard') {
    return repairDashboardValues(sheets, sheetName, dryRun)
  }

  if (pdfRecords.length === 0) {
    const timestamp = buildTimestamp()
    const errorRows = [
      buildLogRow({
        timestamp,
        rowNumber: null,
        clientName: body.pdfFileName || 'Excel',
        status: 'erro',
        action: 'erro_global',
        sources: [],
        errorMessage: 'Excel não encontrado ou sem registros válidos para processar.',
        details: 'A execução foi interrompida antes de consultar planilha, Integra e Trello.',
        cardUrl: '',
      }),
    ]
    await sheets.appendLogRows(errorRows, clearLog)
    await sheets.updateLogDashboard({
      timestamp,
      dryRun,
      sheetName,
      pdfFileName: body.pdfFileName || '',
      processed: 0,
      skipped: 0,
      matched: 0,
      updated: 0,
      refreshed: 0,
      notFound: 0,
      errors: 1,
      logRows: errorRows.length,
      writeStatus: 'Execução interrompida',
    })
    throw new Error('Excel não encontrado ou sem registros válidos para processar.')
  }

  {
    const sheetValues = await sheets.readSheetValues(sheetName)
    if (sheetValues.length < 2) {
      throw new Error(`A aba ${sheetName} nao possui linhas suficientes.`)
    }

    const sheetHeaders = sheetValues[0] || []
    const targetColumns = describeTargetColumns(sheetHeaders)
    const { rows: candidateRows, skipped: skippedRows } = buildSheetClientRows(sheetValues, startRow, maxRows)
    const valueAmountLookup = await loadValueSourceRows(accessToken, spreadsheetId, sheetName, sheetValues)
    const sheetLookup = buildSheetRowLookup(candidateRows)
    const pdfIndex = buildPdfRecordIndex(pdfRecords)
    const selectedEntryFirstPairMatches = new Map<string, SelectedProcessMatch>()
    for (const record of pdfIndex.records) {
      if (!record.entryFirstPairKey) continue
      const match = selectedProcessMatches.get(record.recordKey)
      if (match?.selectionId && !selectedEntryFirstPairMatches.has(record.entryFirstPairKey)) {
        selectedEntryFirstPairMatches.set(record.entryFirstPairKey, match)
      }
    }
    const usedRowNumbers = new Set<number>()
    const integraEnabled = Boolean(Deno.env.get('INTEGRA_API_URL'))
    const integraService = new IntegraService()
    const trelloService = new TrelloService(
      Deno.env.get('TRELLO_API_KEY'),
      Deno.env.get('TRELLO_TOKEN'),
      Deno.env.get('TRELLO_BOARD_ID') || null,
      (Deno.env.get('TRELLO_LIST_IDS') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    )

    const timestamp = buildTimestamp()
    const executionDate = buildCurrentDate()
    const logEntries: AutomationLogEntry[] = []
    const pendingSelections: PendingProcessSelection[] = []
    const updateRequests: Array<{ range: string; values: SheetValues }> = []
    const monthSeparatorRows: number[] = []
    const rowInsertions: Array<{ rowNumber: number; count: number }> = []
    type MonthInsertionCursor = {
      nextRowNumber: number
      monthName: string
      needsSeparator: boolean
    }
    const monthCursors = new Map<string, MonthInsertionCursor>()
    let updated = 0
    let refreshed = 0
    let errors = 0
    let matched = 0
    let notFound = 0
    let createdClients = 0
    let dashboardOpenAmount = 0
    let dashboardPaidAmount = 0
    let dashboardUpcomingAmount = 0
    const lastFilledRow = findLastFilledRow(sheetValues)
    let nextRowNumber = lastFilledRow + 1
    let maxRequestedRow =
      candidateRows.length > 0 ? Math.max(lastFilledRow, ...candidateRows.map((row) => row.rowNumber)) : lastFilledRow
    const stageCounts = new Map<string, number>()
    const recordStatusCounts = new Map<string, number>()
    const actionCounts = new Map<string, number>()

    const registerDashboardMetrics = (params: {
      action: string
      trelloStage: string
      recordStatus: string
      openAmount: number | null
      paidAmount: number | null
      upcomingAmount: number | null
      created: boolean
    }) => {
      incrementMetric(
        actionCounts,
        params.created
          ? 'Cliente adicionado'
          : params.action === 'atualizado'
            ? 'Atualizado'
            : params.action === 'data_atualizada'
              ? 'Só data'
              : params.action,
      )
      incrementMetric(stageCounts, params.trelloStage || 'Sem régua definida')
      incrementMetric(recordStatusCounts, params.recordStatus || 'ATIVO')
      dashboardOpenAmount += params.openAmount || 0
      dashboardPaidAmount += params.paidAmount || 0
      dashboardUpcomingAmount += params.upcomingAmount || 0
      if (params.created) {
        createdClients += 1
      }
    }

    const shiftPlannedRows = (startRow: number, delta: number, exceptCursor?: MonthInsertionCursor) => {
      for (const request of updateRequests) {
        request.range = shiftA1Rows(request.range, startRow, delta)
      }

      for (const entry of logEntries) {
        if (entry.rowNumber && entry.rowNumber >= startRow) {
          entry.rowNumber += delta
        }
      }

      for (let index = 0; index < monthSeparatorRows.length; index += 1) {
        if (monthSeparatorRows[index] >= startRow) {
          monthSeparatorRows[index] += delta
        }
      }

      for (const insertion of rowInsertions) {
        if (insertion.rowNumber >= startRow) {
          insertion.rowNumber += delta
        }
      }

      for (const cursor of monthCursors.values()) {
        if (cursor !== exceptCursor && cursor.nextRowNumber >= startRow) {
          cursor.nextRowNumber += delta
        }
      }

      maxRequestedRow += delta
      nextRowNumber = Math.max(nextRowNumber, maxRequestedRow + 1)
    }

    const getShiftedExistingRowNumber = (rowNumber: number) =>
      rowInsertions.reduce(
        (shiftedRowNumber, insertion) =>
          insertion.rowNumber <= shiftedRowNumber ? shiftedRowNumber + insertion.count : shiftedRowNumber,
        rowNumber,
      )

    const reserveCreatedRow = (sourceDate: string) => {
      const key = getYearMonthKey(sourceDate) || `sem-data-${nextRowNumber}`
      let cursor = monthCursors.get(key)
      if (!cursor) {
        const base = findMonthInsertionBase(sheetValues, sourceDate)
        cursor = {
          nextRowNumber: getShiftedExistingRowNumber(base.rowNumber),
          monthName: base.monthName,
          needsSeparator: base.needsSeparator,
        }
        monthCursors.set(key, cursor)
      }

      const insertionRow = cursor.nextRowNumber
      const shouldCreateSeparator = Boolean(cursor.needsSeparator && cursor.monthName)
      const insertedRowCount = shouldCreateSeparator ? 2 : 1

      shiftPlannedRows(insertionRow, insertedRowCount, cursor)
      rowInsertions.push({ rowNumber: insertionRow, count: insertedRowCount })

      let clientRowNumber = insertionRow
      if (shouldCreateSeparator) {
        addSheetRequest(
          updateRequests,
          sheetName,
          `${quoteSheetName('PLACEHOLDER')}!A${insertionRow}:${columnLetter(TARGET_END_COLUMN_INDEX)}${insertionRow}`,
          [createMonthSeparatorRow(cursor.monthName, Math.max(sheetHeaders.length, TARGET_END_COLUMN_INDEX))],
        )
        monthSeparatorRows.push(insertionRow)
        clientRowNumber = insertionRow + 1
      }

      cursor.needsSeparator = false
      cursor.nextRowNumber = clientRowNumber + 1
      maxRequestedRow = Math.max(maxRequestedRow, clientRowNumber)
      nextRowNumber = Math.max(nextRowNumber, cursor.nextRowNumber)

      return clientRowNumber
    }

    for (const pdfRecord of pdfIndex.records) {
      try {
        const selectedMatch =
          selectedProcessMatches.get(pdfRecord.recordKey) ||
          (pdfRecord.entryFirstPairKey ? selectedEntryFirstPairMatches.get(pdfRecord.entryFirstPairKey) : undefined)
        const selectedSource = valueAmountLookup.entries.find(
          (entry) => entry.selectionId === selectedMatch?.selectionId,
        )
        const matchedRow = resolveSheetRowForPdfRecord(
          pdfRecord,
          sheetLookup,
          usedRowNumbers,
          selectedSource?.code || '',
        )
        const shiftedMatchedRow = matchedRow
          ? {
              ...matchedRow,
              rowNumber: getShiftedExistingRowNumber(matchedRow.rowNumber),
            }
          : null
        const isCreated = !shiftedMatchedRow
        const workingRow: SheetClientRow = shiftedMatchedRow || {
          rowNumber: 0,
          clientName: pdfRecord.name,
          normalizedName: normalizeClientName(pdfRecord.name),
          values: createEmptyRow(Math.max(sheetHeaders.length, TARGET_END_COLUMN_INDEX)),
        }

        if (matchedRow) {
          usedRowNumbers.add(matchedRow.rowNumber)
        }

        matched += 1

        const sources = new Set<string>()
        setIfMissing(sources, 'PDF')

        const integra = integraEnabled
          ? await integraService.lookupClient(workingRow.clientName)
          : {
              found: false,
              status: '',
              dueDate: '',
              amount: null,
              openAmount: null,
              paidAmount: null,
              upcomingAmount: null,
              description: '',
            }

        if (integra.found) setIfMissing(sources, 'Integra')

        const trello = await trelloService.searchClientCard(workingRow.clientName)
        if (trello.found) setIfMissing(sources, 'Trello')

        const errorParts = [integra.error, trello.error].filter(Boolean) as string[]
        const preparedSourceSelection = prepareSourceSelection(
          valueAmountLookup,
          workingRow.normalizedName,
          pdfRecord,
          selectedMatch?.selectionId,
          getCell(workingRow.values, 5),
          allowFallbackSelections,
        )
        const manualOnlySelection = Boolean(selectedMatch?.hasManualAdjustment && !selectedMatch.selectionId)

        if (preparedSourceSelection.pendingSelection && !manualOnlySelection) {
          pendingSelections.push(preparedSourceSelection.pendingSelection)
          continue
        }

        const sourceEntry = preparedSourceSelection.sourceEntry
        const sourceCandidates = resolveSourceCandidatesForClient(valueAmountLookup, workingRow.normalizedName)
        if (!sourceEntry && sourceCandidates.length > 1 && isClosedOrPaidRecord(pdfRecord) && !manualOnlySelection) {
          ignored += 1
          logEntries.push({
            timestamp,
            rowNumber: shiftedMatchedRow?.rowNumber ?? null,
            clientName: workingRow.clientName,
            status: 'quitado_historico_ignorado',
            action: 'ignorado',
            sources: ['Excel'],
            errorMessage: '',
            details: [
              body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
              'Cobrança histórica já paga/quitada e sem correspondência única na Prospecção (PRD).',
            ].filter(Boolean).join(' | '),
            cardUrl: '',
          })
          continue
        }
        if (!sourceEntry && sourceCandidates.length > 1 && !manualOnlySelection) {
          pendingSelections.push(
            buildPendingProcessSelection(pdfRecord, sourceCandidates, getCell(workingRow.values, 5)),
          )
          continue
        }
        if (!sourceEntry && !manualOnlySelection) {
          notFound += 1
          errors += 1
          logEntries.push({
            timestamp,
            rowNumber: shiftedMatchedRow?.rowNumber ?? null,
            clientName: workingRow.clientName,
            status: 'prospeccao_nao_encontrada',
            action: 'aguardando_confirmacao',
            sources: ['PDF'],
            errorMessage: 'Cliente não localizado automaticamente na Prospecção (PRD).',
            details: [
              body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
              pdfRecord.dueDate ? `Vencimento importado: ${normalizeDate(pdfRecord.dueDate)}` : null,
              typeof pdfRecord.amount === 'number' ? `Parcela: ${formatCurrency(pdfRecord.amount)}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
            cardUrl: '',
          })
          continue
        }

        const sourceCode = sourceEntry?.code || getCell(workingRow.values, 5)
        const baseSourceDate = sourceEntry?.date || getCell(workingRow.values, 1)
        const sourceDueDay = sourceEntry?.dueDay || ''
        const sourceFinancialStatus = sourceEntry?.financialStatus || getCell(workingRow.values, 15)
        const totalAmount =
          selectedMatch?.totalAmount ??
          sourceEntry?.amount ??
          parseAmount(getCell(workingRow.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
        const amount = selectedMatch?.amount ?? integra.amount ?? pdfRecord.amount ?? null
        const description = selectedMatch?.description || integra.description || String(pdfRecord.description || '').trim()
        const dueDate =
          selectedMatch?.dueDate ||
          deriveDueDateFromContract(baseSourceDate, sourceDueDay, description, integra.dueDate || pdfRecord.dueDate || '')
        const sourceDate = baseSourceDate || dueDate || normalizeDate(pdfRecord.dueDate) || executionDate
        if (isCreated) {
          workingRow.rowNumber = reserveCreatedRow(sourceDate)
          workingRow.values[SHEET_CLIENT_COLUMN_INDEX - 1] = pdfRecord.name
        }
        const baseStatus = deriveFinancialStatus(
          integra.status,
          sourceFinancialStatus,
          totalAmount,
          amount,
          integra.openAmount,
          integra.paidAmount,
          integra.upcomingAmount,
        )
        const amounts = applyManualAmountOverrides(
          deriveAmounts(totalAmount, baseStatus, amount, description, integra),
          selectedMatch,
        )
        const status = deriveFinalFinancialStatus(
          deriveManualFinancialStatus(
            baseStatus,
            selectedMatch,
            amounts.openAmount,
            amounts.paidAmount,
            amounts.upcomingAmount,
          ),
          totalAmount,
          amount,
          amounts.openAmount,
          amounts.paidAmount,
          amounts.upcomingAmount,
          description,
        )
        const updateTrello = deriveTrelloForUpdate(trello, selectedMatch)
        const updatePlan = buildUpdatePlan(
          workingRow,
          targetColumns,
          timestamp,
          executionDate,
          sourceCode,
          sourceDate,
          [...sources],
          errorParts.join(' | '),
          status,
          dueDate,
          description,
          totalAmount,
          amount,
          amounts.openAmount,
          amounts.paidAmount,
          amounts.upcomingAmount,
          updateTrello,
        )

        if (isCreated) {
          updated += 1
          addSheetRequest(
            updateRequests,
            sheetName,
            `${quoteSheetName('PLACEHOLDER')}!${columnLetter(SHEET_CLIENT_COLUMN_INDEX)}${workingRow.rowNumber}`,
            [[workingRow.clientName]],
          )
          updatePlan.requests.forEach((request) => {
            addSheetRequest(updateRequests, sheetName, request.range, request.values)
          })
        } else if (updatePlan.action === 'atualizado') {
          updated += 1
          updatePlan.requests.forEach((request) => {
            addSheetRequest(updateRequests, sheetName, request.range, request.values)
          })
        } else if (updatePlan.action === 'data_atualizada') {
          refreshed += 1
          updatePlan.requests.forEach((request) => {
            addSheetRequest(updateRequests, sheetName, request.range, request.values)
          })
        }

        if (isCreated || updatePlan.action === 'atualizado' || updatePlan.action === 'data_atualizada') {
          registerDashboardMetrics({
            action: isCreated ? 'cliente_adicionado' : updatePlan.action,
            trelloStage: resolveStageForMetrics(workingRow, targetColumns, updateTrello),
            recordStatus: deriveRecordStatus(updateTrello),
            openAmount: amounts.openAmount,
            paidAmount: amounts.paidAmount,
            upcomingAmount: amounts.upcomingAmount,
            created: isCreated,
          })
        }

        if (errorParts.length > 0) {
          errors += 1
        }

        if (isCreated || updatePlan.action === 'atualizado' || updatePlan.action === 'data_atualizada') {
          const changedLabels = isCreated
            ? ['CLIENTE', ...updatePlan.changedColumnLabels]
            : updatePlan.changedColumnLabels

          logEntries.push({
            timestamp,
            rowNumber: workingRow.rowNumber,
            clientName: workingRow.clientName,
            status: errorParts.length > 0
              ? 'erro_parcial'
              : isCreated
                ? 'cliente_adicionado_na_planilha'
                : status || 'processado',
            action: isCreated ? 'cliente_adicionado' : updatePlan.action,
            sources: [...sources],
            errorMessage: errorParts.join(' | '),
            details: [
              isCreated ? `Nova linha criada na planilha: ${workingRow.rowNumber}` : null,
              changedLabels.length > 0 ? `Colunas alteradas: ${changedLabels.join(', ')}` : null,
              !isCreated && updatePlan.action === 'data_atualizada'
                ? 'Sem mudança de conteúdo; apenas data da atualização foi renovada.'
                : null,
              body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
              updateTrello.resultLabel ? `Trello: ${updateTrello.resultLabel}` : null,
              dueDate ? `Vencimento: ${dueDate}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
            cardUrl: trello.cardUrl,
          })
        }
      } catch (error) {
        notFound += 1
        errors += 1
        logEntries.push({
          timestamp,
          rowNumber: null,
          clientName: pdfRecord.name,
          status: 'erro_no_processamento',
          action: 'nao_encontrado',
          sources: ['PDF'],
          errorMessage: error instanceof Error ? error.message : 'Falha ao processar cliente do PDF.',
          details: [
            body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
            pdfRecord.dueDate ? `Vencimento: ${normalizeDate(pdfRecord.dueDate)}` : null,
            typeof pdfRecord.amount === 'number' ? `Valor: ${formatCurrency(pdfRecord.amount)}` : null,
          ]
            .filter(Boolean)
            .join(' | '),
          cardUrl: '',
        })
      }
    }

    let updateFailureMessage = ''
    if (!dryRun && (updateRequests.length > 0 || normalizeLayout)) {
      try {
        await sheets.ensureRowCapacity(sheetName, maxRequestedRow)
        await sheets.insertRows(sheetName, rowInsertions)
        await sheets.ensureDropdownFormatting(sheetName, targetColumns, maxRequestedRow)
        if (updateRequests.length > 0) {
          await sheets.batchUpdateValues(updateRequests)
        }
        if (normalizeLayout) {
          const sortedLayout = buildSortedMonthlySheetLayout(
            await sheets.readSheetValues(sheetName),
            Math.max(sheetHeaders.length, TARGET_END_COLUMN_INDEX),
          )
          await sheets.ensureRowCapacity(sheetName, sortedLayout.lastRowNumber)
          await sheets.updateValues(
            `${quoteSheetName(sheetName)}!A2:${columnLetter(TARGET_END_COLUMN_INDEX)}${sortedLayout.lastRowNumber}`,
            sortedLayout.values,
          )
          await sheets.formatMonthlyLayoutRows(sheetName, sortedLayout.lastRowNumber, sortedLayout.separatorRows)

          for (const entry of logEntries) {
            if (entry.rowNumber && sortedLayout.rowNumberByOriginalRow.has(entry.rowNumber)) {
              entry.rowNumber = sortedLayout.rowNumberByOriginalRow.get(entry.rowNumber) || entry.rowNumber
            }
          }
        }
      } catch (error) {
        updateFailureMessage = `Falha ao atualizar Google Sheets: ${error instanceof Error ? error.message : 'erro desconhecido'}`
        errors += 1
        logEntries.push({
          timestamp,
          rowNumber: null,
          clientName: sheetName,
          status: 'erro_google_sheets',
          action: 'erro_atualizacao',
          sources: [],
          errorMessage: updateFailureMessage,
          details: 'A escrita na planilha falhou depois do processamento dos clientes.',
          cardUrl: '',
        })
      }
    }

    await sheets.appendLogRows(logEntries.map(buildLogRow), clearLog)

    if (updateFailureMessage) {
      throw new Error(updateFailureMessage)
    }

    return {
      dryRun,
      sheetName,
      pdfFileName: body.pdfFileName || '',
      timestamp,
      startRow,
      processed: candidateRows.length,
      skipped: skippedRows,
      matched,
      updated,
      refreshed,
      ignored: Math.max(candidateRows.length - usedRowNumbers.size, 0),
      notFound,
      errors,
      updatedCells: dryRun ? 0 : updateRequests.length,
      logRows: logEntries.length,
      preview: logEntries.map(buildPreviewRow),
      pendingCount: pendingSelections.length,
      pendingSelections,
      dashboard: {
        created: createdClients,
        updated,
        refreshed,
        pending: pendingSelections.length,
        notFound,
        errors,
        matched,
        processed: candidateRows.length,
        financial: {
          openAmount: dashboardOpenAmount,
          paidAmount: dashboardPaidAmount,
          upcomingAmount: dashboardUpcomingAmount,
        },
        stageBreakdown: metricMapToArray(stageCounts, [...REGUA_OPTIONS, 'Sem régua definida']),
        recordStatusBreakdown: metricMapToArray(recordStatusCounts, ['ATIVO', 'INATIVO']),
        actionBreakdown: metricMapToArray(actionCounts, ['Atualizado', 'Cliente adicionado', 'Só data']),
      },
    }
  }

  const values = await sheets.readSheetValues(sheetName)
  if (values.length < 2) {
    throw new Error(`A aba ${sheetName} nao possui linhas suficientes.`)
  }

  const headers = values[0] || []
  const targetColumns = describeTargetColumns(headers)
  const { rows: sheetRows, skipped } = buildSheetClientRows(values, startRow, maxRows)
  const valueAmountLookup = await loadValueSourceRows(accessToken, spreadsheetId, sheetName, values)
  const pdfIndex = buildPdfRecordIndex(pdfRecords)
  const matchedPdfRecordKeys = new Set<string>()
  const integraService = new IntegraService()
  const trelloService = new TrelloService(
    Deno.env.get('TRELLO_API_KEY'),
    Deno.env.get('TRELLO_TOKEN'),
    Deno.env.get('TRELLO_BOARD_ID') || null,
    (Deno.env.get('TRELLO_LIST_IDS') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )

  const timestamp = buildTimestamp()
  const executionDate = buildCurrentDate()
  const logEntries: AutomationLogEntry[] = []
  const pendingSelections: PendingProcessSelection[] = []
  const updateRequests: Array<{ range: string; values: SheetValues }> = []
  const monthSeparatorRows: number[] = []
  let updated = 0
  let refreshed = 0
  let ignored = 0
  let notFound = 0
  let errors = 0
  let matched = 0
  let nextRowNumber = findLastFilledRow(values) + 1
  let activeMonthName = findLastVisibleMonth(values)

  const addMonthSeparatorIfNeeded = (row: SheetClientRow, sourceDate: string) => {
    const monthName = resolveMonthName(sourceDate)
    if (!monthName || monthName === activeMonthName) return

    const separatorRowNumber = row.rowNumber
    addSheetRequest(
      updateRequests,
      sheetName,
      `${quoteSheetName('PLACEHOLDER')}!A${separatorRowNumber}:${columnLetter(TARGET_END_COLUMN_INDEX)}${separatorRowNumber}`,
      [createMonthSeparatorRow(monthName, Math.max(headers.length, TARGET_END_COLUMN_INDEX))],
    )
    monthSeparatorRows.push(separatorRowNumber)
    activeMonthName = monthName
    row.rowNumber += 1
    nextRowNumber += 1
  }

  const processMatchedRow = async (
    row: SheetClientRow,
    pdfRecord: PreparedPdfRecord,
    options: { created: boolean },
  ) => {
    matched += 1
    matchedPdfRecordKeys.add(pdfRecord.recordKey)

    const sources = new Set<string>()
    setIfMissing(sources, 'PDF')

    const integra = await integraService.lookupClient(row.clientName)
    if (integra.found) setIfMissing(sources, 'Integra')

    const trello = await trelloService.searchClientCard(row.clientName)
    if (trello.found) setIfMissing(sources, 'Trello')

    const errorParts = [integra.error, trello.error].filter(Boolean) as string[]
    const selectedMatch = selectedProcessMatches.get(pdfRecord.recordKey)
    const amount = selectedMatch?.amount ?? integra.amount ?? pdfRecord.amount ?? null
    const description = selectedMatch?.description || integra.description || String(pdfRecord.description || '').trim()
    const preparedSourceSelection = prepareSourceSelection(
      valueAmountLookup,
      row.normalizedName,
      pdfRecord,
      selectedMatch?.selectionId,
      getCell(row.values, 5),
      allowFallbackSelections,
    )
    if (preparedSourceSelection.pendingSelection) {
      pendingSelections.push(preparedSourceSelection.pendingSelection)
      return
    }
    const sourceEntry = preparedSourceSelection.sourceEntry
    const sourceCandidates = resolveSourceCandidatesForClient(valueAmountLookup, row.normalizedName)
    if (!sourceEntry && sourceCandidates.length > 1 && isClosedOrPaidRecord(pdfRecord)) {
      ignored += 1
      logEntries.push({
        timestamp,
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        status: 'quitado_historico_ignorado',
        action: 'ignorado',
        sources: ['Excel'],
        errorMessage: '',
        details: [
          body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
          'Cobrança histórica já paga/quitada e sem correspondência única na Prospecção (PRD).',
        ].filter(Boolean).join(' | '),
        cardUrl: '',
      })
      return
    }
    if (!sourceEntry && sourceCandidates.length > 1) {
      pendingSelections.push(buildPendingProcessSelection(pdfRecord, sourceCandidates, getCell(row.values, 5)))
      return
    }
    if (!sourceEntry) {
      notFound += 1
      errors += 1
      logEntries.push({
        timestamp,
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        status: 'prospeccao_nao_encontrada',
        action: 'aguardando_confirmacao',
        sources: ['PDF'],
        errorMessage: 'Cliente não localizado automaticamente na Prospecção (PRD).',
        details: [
          body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
          pdfRecord.dueDate ? `Vencimento importado: ${normalizeDate(pdfRecord.dueDate)}` : null,
          typeof pdfRecord.amount === 'number' ? `Parcela: ${formatCurrency(pdfRecord.amount)}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
        cardUrl: '',
      })
      return
    }
    const sourceCode = sourceEntry?.code || getCell(row.values, 5)
    const sourceDate = sourceEntry?.date || getCell(row.values, 1)
    if (options.created) {
      addMonthSeparatorIfNeeded(row, sourceDate)
    }
    const sourceDueDay = sourceEntry?.dueDay || ''
    const sourceFinancialStatus = sourceEntry?.financialStatus || getCell(row.values, 15)
    const totalAmount =
      selectedMatch?.totalAmount ?? sourceEntry?.amount ?? parseAmount(getCell(row.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
    const dueDate =
      selectedMatch?.dueDate ||
      deriveDueDateFromContract(sourceDate, sourceDueDay, description, integra.dueDate || pdfRecord.dueDate || '')
    const baseStatus = deriveFinancialStatus(
      integra.status,
      sourceFinancialStatus,
      totalAmount,
      amount,
      integra.openAmount,
      integra.paidAmount,
      integra.upcomingAmount,
    )
    const amounts = applyManualAmountOverrides(deriveAmounts(totalAmount, baseStatus, amount, description, integra), selectedMatch)
    const status = deriveFinalFinancialStatus(
      deriveManualFinancialStatus(
        baseStatus,
        selectedMatch,
        amounts.openAmount,
        amounts.paidAmount,
        amounts.upcomingAmount,
      ),
      totalAmount,
      amount,
      amounts.openAmount,
      amounts.paidAmount,
      amounts.upcomingAmount,
      description,
    )
    const updateTrello = deriveTrelloForUpdate(trello, selectedMatch)
    const updatePlan = buildUpdatePlan(
      row,
      targetColumns,
      timestamp,
      executionDate,
      sourceCode,
      sourceDate,
      [...sources],
      errorParts.join(' | '),
      status,
      dueDate,
      description,
      totalAmount,
      amount,
      amounts.openAmount,
      amounts.paidAmount,
      amounts.upcomingAmount,
      updateTrello,
    )

    if (options.created) {
      updated += 1
      addSheetRequest(
        updateRequests,
        sheetName,
        `${quoteSheetName('PLACEHOLDER')}!${columnLetter(SHEET_CLIENT_COLUMN_INDEX)}${row.rowNumber}`,
        [[row.clientName]],
      )
      updatePlan.requests.forEach((request) => {
        addSheetRequest(updateRequests, sheetName, request.range, request.values)
      })
    } else if (updatePlan.action === 'atualizado') {
      updated += 1
      updatePlan.requests.forEach((request) => {
        addSheetRequest(updateRequests, sheetName, request.range, request.values)
      })
    } else if (updatePlan.action === 'data_atualizada') {
      refreshed += 1
      updatePlan.requests.forEach((request) => {
        addSheetRequest(updateRequests, sheetName, request.range, request.values)
      })
    } else {
      ignored += 1
    }

    if (errorParts.length > 0) {
      errors += 1
    }

    if (options.created || updatePlan.action === 'atualizado' || updatePlan.action === 'data_atualizada') {
      const changedLabels = options.created
        ? ['CLIENTE', ...updatePlan.changedColumnLabels]
        : updatePlan.changedColumnLabels

      logEntries.push({
        timestamp,
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        status: errorParts.length > 0
          ? 'erro_parcial'
          : options.created
            ? 'cliente_adicionado_na_planilha'
            : status || 'processado',
        action: options.created ? 'cliente_adicionado' : updatePlan.action,
        sources: [...sources],
        errorMessage: errorParts.join(' | '),
        details: [
          options.created ? `Nova linha criada na planilha: ${row.rowNumber}` : null,
          changedLabels.length > 0 ? `Colunas alteradas: ${changedLabels.join(', ')}` : null,
          !options.created && updatePlan.action === 'data_atualizada'
            ? 'Sem mudança de conteúdo; apenas data da atualização foi renovada.'
            : null,
          body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
          updateTrello.resultLabel ? `Trello: ${updateTrello.resultLabel}` : null,
          dueDate ? `Vencimento: ${dueDate}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
        cardUrl: trello.cardUrl,
      })
    }
  }

  for (const row of sheetRows) {
    const pdfRecord = resolvePdfRecordForRow(row, pdfIndex, matchedPdfRecordKeys)
    if (!pdfRecord) {
      ignored += 1
      continue
    }

    await processMatchedRow(row, pdfRecord, { created: false })
    continue

    matched += 1
    matchedPdfRecordKeys.add(pdfRecord.recordKey)

    const sources = new Set<string>()
    setIfMissing(sources, 'PDF')

    const integra = await integraService.lookupClient(row.clientName)
    if (integra.found) setIfMissing(sources, 'Integra')

    const trello = await trelloService.searchClientCard(row.clientName)
    if (trello.found) setIfMissing(sources, 'Trello')

    const errorParts = [integra.error, trello.error].filter(Boolean) as string[]
    const selectedMatch = selectedProcessMatches.get(pdfRecord.recordKey)
    const amount = selectedMatch?.amount ?? integra.amount ?? pdfRecord.amount ?? null
    const description = selectedMatch?.description || integra.description || String(pdfRecord.description || '').trim()
    const preparedSourceSelection = prepareSourceSelection(
      valueAmountLookup,
      row.normalizedName,
      pdfRecord,
      selectedMatch?.selectionId,
      getCell(row.values, 5),
      allowFallbackSelections,
    )
    if (preparedSourceSelection.pendingSelection) {
      pendingSelections.push(preparedSourceSelection.pendingSelection)
      continue
    }
    const sourceEntry = preparedSourceSelection.sourceEntry
    const sourceCandidates = resolveSourceCandidatesForClient(valueAmountLookup, row.normalizedName)
    if (!sourceEntry && sourceCandidates.length > 1 && isClosedOrPaidRecord(pdfRecord)) {
      ignored += 1
      logEntries.push({
        timestamp,
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        status: 'quitado_historico_ignorado',
        action: 'ignorado',
        sources: ['Excel'],
        errorMessage: '',
        details: [
          body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
          'Cobrança histórica já paga/quitada e sem correspondência única na Prospecção (PRD).',
        ].filter(Boolean).join(' | '),
        cardUrl: '',
      })
      continue
    }
    if (!sourceEntry && sourceCandidates.length > 1) {
      pendingSelections.push(buildPendingProcessSelection(pdfRecord, sourceCandidates, getCell(row.values, 5)))
      continue
    }
    if (!sourceEntry) {
      notFound += 1
      errors += 1
      logEntries.push({
        timestamp,
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        status: 'prospeccao_nao_encontrada',
        action: 'aguardando_confirmacao',
        sources: ['PDF'],
        errorMessage: 'Cliente não localizado automaticamente na Prospecção (PRD).',
        details: [
          body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
          pdfRecord.dueDate ? `Vencimento importado: ${normalizeDate(pdfRecord.dueDate)}` : null,
          typeof pdfRecord.amount === 'number' ? `Parcela: ${formatCurrency(pdfRecord.amount)}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
        cardUrl: '',
      })
      continue
    }
    const sourceCode = sourceEntry?.code || getCell(row.values, 5)
    const sourceDate = sourceEntry?.date || getCell(row.values, 1)
    const sourceDueDay = sourceEntry?.dueDay || ''
    const sourceFinancialStatus = sourceEntry?.financialStatus || getCell(row.values, 15)
    const totalAmount =
      selectedMatch?.totalAmount ?? sourceEntry?.amount ?? parseAmount(getCell(row.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
    const dueDate =
      selectedMatch?.dueDate ||
      deriveDueDateFromContract(sourceDate, sourceDueDay, description, integra.dueDate || pdfRecord.dueDate || '')
    const baseStatus = deriveFinancialStatus(
      integra.status,
      sourceFinancialStatus,
      totalAmount,
      amount,
      integra.openAmount,
      integra.paidAmount,
      integra.upcomingAmount,
    )
    const amounts = applyManualAmountOverrides(deriveAmounts(totalAmount, baseStatus, amount, description, integra), selectedMatch)
    const status = deriveFinalFinancialStatus(
      deriveManualFinancialStatus(
        baseStatus,
        selectedMatch,
        amounts.openAmount,
        amounts.paidAmount,
        amounts.upcomingAmount,
      ),
      totalAmount,
      amount,
      amounts.openAmount,
      amounts.paidAmount,
      amounts.upcomingAmount,
      description,
    )
    const updatePlan = buildUpdatePlan(
      row,
      targetColumns,
      timestamp,
      executionDate,
      sourceCode,
      sourceDate,
      [...sources],
      errorParts.join(' | '),
      status,
      dueDate,
      description,
      totalAmount,
      amount,
      amounts.openAmount,
      amounts.paidAmount,
      amounts.upcomingAmount,
      trello,
    )

    if (updatePlan.action === 'atualizado') {
      updated += 1
      updatePlan.requests.forEach((request) => {
        updateRequests.push({
          range: request.range.replace(quoteSheetName('PLACEHOLDER'), quoteSheetName(sheetName)),
          values: request.values,
        })
      })
    } else if (updatePlan.action === 'data_atualizada') {
      refreshed += 1
      updatePlan.requests.forEach((request) => {
        updateRequests.push({
          range: request.range.replace(quoteSheetName('PLACEHOLDER'), quoteSheetName(sheetName)),
          values: request.values,
        })
      })
    } else {
      ignored += 1
    }

    if (errorParts.length > 0) {
      errors += 1
    }

    if (updatePlan.action === 'atualizado' || updatePlan.action === 'data_atualizada') {
      logEntries.push({
        timestamp,
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        status: errorParts.length > 0 ? 'erro_parcial' : status || 'processado',
        action: updatePlan.action,
        sources: [...sources],
        errorMessage: errorParts.join(' | '),
        details: [
          updatePlan.action === 'atualizado' && updatePlan.changedColumnLabels.length > 0
            ? `Colunas alteradas: ${updatePlan.changedColumnLabels.join(', ')}`
            : null,
          updatePlan.action === 'data_atualizada'
            ? 'Sem mudança de conteúdo; apenas data da atualização foi renovada.'
            : null,
          body.pdfFileName ? `PDF: ${body.pdfFileName}` : null,
          trello.resultLabel ? `Trello: ${trello.resultLabel}` : null,
          dueDate ? `Vencimento: ${dueDate}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
        cardUrl: trello.cardUrl,
      })
    }
  }

  for (const pdfRecord of pdfIndex.records) {
    if (matchedPdfRecordKeys.has(pdfRecord.recordKey)) continue

    const newRowValues = createEmptyRow(Math.max(headers.length, TARGET_END_COLUMN_INDEX))
    newRowValues[SHEET_CLIENT_COLUMN_INDEX - 1] = pdfRecord.name

    const newRow: SheetClientRow = {
      rowNumber: nextRowNumber,
      clientName: pdfRecord.name,
      normalizedName: normalizeClientName(pdfRecord.name),
      values: newRowValues,
    }

    nextRowNumber += 1
    await processMatchedRow(newRow, pdfRecord, { created: true })
    continue

    notFound += 1
    logEntries.push({
      timestamp,
      rowNumber: null,
      clientName: pdfRecord.name,
      status: 'cliente_nao_encontrado_na_planilha',
      action: 'nao_encontrado',
      sources: ['PDF'],
      errorMessage: 'Cliente do Excel não foi localizado na coluna I da planilha.',
      details: [
        body.pdfFileName ? `Excel: ${body.pdfFileName}` : null,
        pdfRecord.dueDate ? `Vencimento: ${normalizeDate(pdfRecord.dueDate)}` : null,
        typeof pdfRecord.amount === 'number' ? `Valor: ${formatCurrency(pdfRecord.amount)}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
      cardUrl: '',
    })
  }

  if (dryRun) {
    logEntries.push({
      timestamp,
      rowNumber: null,
      clientName: body.pdfFileName || 'Excel',
      status: 'pre_visualizacao',
      action: 'dry_run',
      sources: [],
      errorMessage: '',
      details: 'Prévia executada sem gravar alterações na aba principal. DATA DA ATUALIZAÇÃO só muda em execução real.',
      cardUrl: '',
    })
  }

  let updateFailureMessage = ''
  if (!dryRun && (updateRequests.length > 0 || normalizeLayout)) {
    try {
      const maxRequestedRow = Math.max(values.length, nextRowNumber)
      await sheets.ensureRowCapacity(sheetName, maxRequestedRow)
      await sheets.ensureDropdownFormatting(sheetName, targetColumns, maxRequestedRow)
      if (updateRequests.length > 0) {
        await sheets.batchUpdateValues(updateRequests)
      }
      if (normalizeLayout) {
        const sortedLayout = buildSortedMonthlySheetLayout(
          await sheets.readSheetValues(sheetName),
          Math.max(sheetHeaders.length, TARGET_END_COLUMN_INDEX),
        )
        await sheets.ensureRowCapacity(sheetName, sortedLayout.lastRowNumber)
        await sheets.updateValues(
          `${quoteSheetName(sheetName)}!A2:${columnLetter(TARGET_END_COLUMN_INDEX)}${sortedLayout.lastRowNumber}`,
          sortedLayout.values,
        )
        await sheets.formatMonthlyLayoutRows(sheetName, sortedLayout.lastRowNumber, sortedLayout.separatorRows)

        for (const entry of logEntries) {
          if (entry.rowNumber && sortedLayout.rowNumberByOriginalRow.has(entry.rowNumber)) {
            entry.rowNumber = sortedLayout.rowNumberByOriginalRow.get(entry.rowNumber) || entry.rowNumber
          }
        }
      }
    } catch (error) {
      updateFailureMessage = `Falha ao atualizar Google Sheets: ${error instanceof Error ? error.message : 'erro desconhecido'}`
      errors += 1
      logEntries.push({
        timestamp,
        rowNumber: null,
        clientName: sheetName,
        status: 'erro_google_sheets',
        action: 'erro_atualizacao',
        sources: [],
        errorMessage: updateFailureMessage,
        details: 'A escrita na planilha falhou depois do processamento dos clientes.',
        cardUrl: '',
      })
    }
  }

  await sheets.appendLogRows(logEntries.map(buildLogRow), clearLog)

  if (updateFailureMessage) {
    throw new Error(updateFailureMessage)
  }

  return {
    dryRun,
    sheetName,
    pdfFileName: body.pdfFileName || '',
    timestamp,
    startRow,
    processed: sheetRows.length,
    skipped,
    matched,
    updated,
    refreshed,
    ignored,
    notFound,
    errors,
      updatedCells: dryRun ? 0 : updateRequests.length,
    logRows: logEntries.length,
    preview: logEntries.map(buildPreviewRow),
    pendingCount: pendingSelections.length,
    pendingSelections,
    dashboard: {
      created: 0,
      updated,
      refreshed,
      pending: pendingSelections.length,
      notFound,
      errors,
      matched,
      processed: sheetRows.length,
      financial: {
        openAmount: 0,
        paidAmount: 0,
        upcomingAmount: 0,
      },
      stageBreakdown: [],
      recordStatusBreakdown: [],
      actionBreakdown: [],
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Use POST.' }, 405)
  }

  try {
    return jsonResponse(await runAutomation(req))
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Erro desconhecido.' }, 500)
  }
})
