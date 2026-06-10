import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const LOG_SHEET_NAME = 'LOG_AUTOMACAO'
const SHEET_CLIENT_COLUMN_INDEX = 9
const SHEET_TOTAL_VALUE_COLUMN_INDEX = 11
const TARGET_START_COLUMN_INDEX = 1 // A
const TARGET_END_COLUMN_INDEX = 32 // AF
const DEFAULT_VALUE_SOURCE_SHEET_NAME = 'Clientes(V1)'
const MONTH_NAMES = [
  'JANEIRO',
  'FEVEREIRO',
  'MARCO',
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

type SheetValues = string[][]
type AutomationBody = {
  dryRun?: boolean
  maxRows?: number
  startRow?: number
  sheetName?: string
  pdfFileName?: string
  pdfRecords?: PdfRecord[]
}

type PdfRecord = {
  name: string
  dueDate?: string
  amount?: number
  description?: string
  email?: string
}

type PreparedPdfRecord = PdfRecord & {
  normalizedName: string
  matchStem: string
  truncated: boolean
  recordKey: string
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
  values: string[]
}

type ColumnRole =
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

type AutomationResult = {
  dryRun: boolean
  sheetName: string
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

function getCell(row: string[], columnIndexOneBased: number) {
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

type SheetAmountEntry = {
  normalizedName: string
  amount: number
}

function buildSheetAmountLookup(rows: SheetClientRow[]) {
  const exactLookup = new Map<string, number>()
  const entries: SheetAmountEntry[] = []

  for (const row of rows) {
    const amount = parseAmount(getCell(row.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
    if (amount === null) continue
    exactLookup.set(row.normalizedName, amount)
    entries.push({
      normalizedName: row.normalizedName,
      amount,
    })
  }

  return { exactLookup, entries }
}

function resolveAmountForClient(
  lookup: ReturnType<typeof buildSheetAmountLookup>,
  normalizedClientName: string,
) {
  const exact = lookup.exactLookup.get(normalizedClientName)
  if (exact !== undefined) return exact

  const truncatedMatch = lookup.entries.find((entry) =>
    canMatchTruncatedName(entry.normalizedName, normalizedClientName) ||
    canMatchTruncatedName(normalizedClientName, entry.normalizedName) ||
    entry.normalizedName.startsWith(normalizedClientName) ||
    normalizedClientName.startsWith(entry.normalizedName),
  )

  return truncatedMatch?.amount ?? null
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

  return { records, exactLookup }
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
    .filter((record) => record.truncated && canMatchTruncatedName(row.normalizedName, record.matchStem))
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

  async appendLogRows(rows: SheetValues) {
    await this.request('/values:batchClear', {
      method: 'POST',
      body: JSON.stringify({
        ranges: [`${quoteSheetName(LOG_SHEET_NAME)}!A2:I5000`],
      }),
    })

    if (rows.length === 0) return

    await this.updateValues(
      `${quoteSheetName(LOG_SHEET_NAME)}!A2:I${rows.length + 1}`,
      rows,
    )
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
    const cacheKey = normalizeClientName(clientName)
    const cached = this.clientLookupCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const lookupPromise = this.searchClientCardInternal(clientName)
    this.clientLookupCache.set(cacheKey, lookupPromise)
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
      cards_limit: '20',
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
  dueDate: string,
  integraStatus: string,
  amount: number | null,
  openAmount: number | null,
  paidAmount: number | null,
  upcomingAmount: number | null,
) {
  const normalizedIntegraStatus = normalizeStatus(integraStatus)
  if (normalizedIntegraStatus) return normalizedIntegraStatus
  if ((paidAmount || 0) > 0 && (openAmount || 0) <= 0) return 'QUITADO'
  if ((upcomingAmount || 0) > 0) return 'A VENCER'
  if ((openAmount || 0) > 0) return 'EM ATRASO'

  const days = dueDate ? diffDaysFromToday(dueDate) : null
  if (days !== null && days > 0) return 'EM ATRASO'
  if (days !== null && days <= 0 && (amount || 0) > 0) return 'A VENCER'
  return amount ? 'EM DIA' : ''
}

function deriveAmounts(
  totalAmount: number | null,
  dueDate: string,
  status: string,
  amount: number | null,
  description: string,
  integra: IntegraLookupResult,
) {
  const parsedAmount = amount && Number.isFinite(amount) ? amount : null
  const openAmount = integra.openAmount
  const paidAmount = integra.paidAmount
  const upcomingAmount = integra.upcomingAmount

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

  const days = dueDate ? diffDaysFromToday(dueDate) : null
  if (days !== null && days > 0) {
    return { openAmount: parsedAmount, paidAmount: 0, upcomingAmount: 0 }
  }

  return { openAmount: 0, paidAmount: 0, upcomingAmount: parsedAmount }
}

function deriveRecordStatus(trello: TrelloLookupResult) {
  return trello.statusLabel || 'ATIVO'
}

function computeColumnValue(
  column: TargetColumn,
  timestamp: string,
  executionDate: string,
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
    case 'fillDate':
      return executionDate
    case 'dueDate':
      return dueDate
    case 'amount':
      return formatCurrency(totalAmount)
    case 'description':
      return description
    case 'financialStatus':
      return status
    case 'recordStatus':
      return deriveRecordStatus(trello)
    case 'openAmount':
      return formatCurrency(openAmount)
    case 'paidAmount':
      return formatCurrency(paidAmount)
    case 'upcomingAmount':
      return formatCurrency(upcomingAmount)
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
    const nextValue = computeColumnValue(
      column,
      timestamp,
      executionDate,
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
    newValues.set(column.index, nextValue)

    if (column.role === 'updatedAt') {
      dateColumns.push(column.index)
      continue
    }

    const currentValue = getCell(row.values, column.index)
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
) {
  const exactMatches = (sheetLookup.exactLookup.get(pdfRecord.normalizedName) || []).filter(
    (row) => !usedRowNumbers.has(row.rowNumber),
  )

  if (exactMatches.length > 0) {
    return exactMatches[0]
  }

  if (!pdfRecord.truncated) {
    return null
  }

  const truncatedMatches = sheetLookup.rows
    .filter((row) => !usedRowNumbers.has(row.rowNumber))
    .filter((row) => canMatchTruncatedName(row.normalizedName, pdfRecord.matchStem))
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

  if (!spreadsheetId) {
    throw new Error('Variavel obrigatoria ausente: GOOGLE_SPREADSHEET_ID')
  }

  const accessToken = await getGoogleAccessToken()
  const sheets = new GoogleSheetsService(spreadsheetId, accessToken)
  await sheets.ensureColumnCapacity(sheetName, TARGET_END_COLUMN_INDEX)
  await sheets.ensureLogSheet()

  if (pdfRecords.length === 0) {
    const timestamp = buildTimestamp()
    const errorRows = [
      buildLogRow({
        timestamp,
        rowNumber: null,
        clientName: body.pdfFileName || 'PDF',
        status: 'erro',
        action: 'erro_global',
        sources: [],
        errorMessage: 'PDF não encontrado ou sem registros válidos para processar.',
        details: 'A execução foi interrompida antes de consultar planilha, Integra e Trello.',
        cardUrl: '',
      }),
    ]
    await sheets.appendLogRows(errorRows)
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
    throw new Error('PDF não encontrado ou sem registros válidos para processar.')
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
    const updateRequests: Array<{ range: string; values: SheetValues }> = []
    let updated = 0
    let refreshed = 0
    let errors = 0
    let matched = 0
    let notFound = 0
    const lastFilledRow = findLastFilledRow(sheetValues)
    let nextRowNumber = lastFilledRow + 1
    let maxRequestedRow =
      candidateRows.length > 0 ? Math.max(lastFilledRow, ...candidateRows.map((row) => row.rowNumber)) : lastFilledRow

    for (const pdfRecord of pdfIndex.records) {
      try {
        const matchedRow = resolveSheetRowForPdfRecord(pdfRecord, sheetLookup, usedRowNumbers)
        const isCreated = !matchedRow
        const workingRow: SheetClientRow = matchedRow || {
          rowNumber: nextRowNumber,
          clientName: pdfRecord.name,
          normalizedName: normalizeClientName(pdfRecord.name),
          values: createEmptyRow(Math.max(sheetHeaders.length, TARGET_END_COLUMN_INDEX)),
        }

        if (!matchedRow) {
          workingRow.values[SHEET_CLIENT_COLUMN_INDEX - 1] = pdfRecord.name
          maxRequestedRow = Math.max(maxRequestedRow, workingRow.rowNumber)
          nextRowNumber += 1
        } else {
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
        const dueDate = normalizeDate(integra.dueDate || pdfRecord.dueDate || '')
        const totalAmount = resolveAmountForClient(valueAmountLookup, workingRow.normalizedName) ?? parseAmount(getCell(workingRow.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
        const amount = integra.amount ?? pdfRecord.amount ?? null
        const description = integra.description || String(pdfRecord.description || '').trim()
        const status = deriveFinancialStatus(
          dueDate,
          integra.status,
          amount,
          integra.openAmount,
          integra.paidAmount,
          integra.upcomingAmount,
        )
        const amounts = deriveAmounts(totalAmount, dueDate, status, amount, description, integra)
        const updatePlan = buildUpdatePlan(
          workingRow,
          targetColumns,
          timestamp,
          executionDate,
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
              body.pdfFileName ? `PDF: ${body.pdfFileName}` : null,
              trello.resultLabel ? `Trello: ${trello.resultLabel}` : null,
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
            body.pdfFileName ? `PDF: ${body.pdfFileName}` : null,
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
    if (!dryRun && updateRequests.length > 0) {
      try {
        await sheets.ensureRowCapacity(sheetName, maxRequestedRow)
        await sheets.batchUpdateValues(updateRequests)
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

    await sheets.appendLogRows(logEntries.map(buildLogRow))

    if (updateFailureMessage) {
      throw new Error(updateFailureMessage)
    }

    return {
      dryRun,
      sheetName,
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
  const updateRequests: Array<{ range: string; values: SheetValues }> = []
  let updated = 0
  let refreshed = 0
  let ignored = 0
  let notFound = 0
  let errors = 0
  let matched = 0
  let nextRowNumber = findLastFilledRow(values) + 1

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
    const dueDate = normalizeDate(integra.dueDate || pdfRecord.dueDate || '')
    const amount = integra.amount ?? pdfRecord.amount ?? null
    const description = integra.description || String(pdfRecord.description || '').trim()
    const status = deriveFinancialStatus(
      dueDate,
      integra.status,
      amount,
      integra.openAmount,
      integra.paidAmount,
      integra.upcomingAmount,
    )
    const totalAmount = resolveAmountForClient(valueAmountLookup, row.normalizedName) ?? parseAmount(getCell(row.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
    const amounts = deriveAmounts(totalAmount, dueDate, status, amount, description, integra)
    const updatePlan = buildUpdatePlan(
      row,
      targetColumns,
      timestamp,
      executionDate,
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
    const dueDate = normalizeDate(integra.dueDate || pdfRecord.dueDate || '')
    const amount = integra.amount ?? pdfRecord.amount ?? null
    const description = integra.description || String(pdfRecord.description || '').trim()
    const status = deriveFinancialStatus(
      dueDate,
      integra.status,
      amount,
      integra.openAmount,
      integra.paidAmount,
      integra.upcomingAmount,
    )
    const totalAmount = resolveAmountForClient(valueAmountLookup, row.normalizedName) ?? parseAmount(getCell(row.values, SHEET_TOTAL_VALUE_COLUMN_INDEX))
    const amounts = deriveAmounts(totalAmount, dueDate, status, amount, description, integra)
    const updatePlan = buildUpdatePlan(
      row,
      targetColumns,
      timestamp,
      executionDate,
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
      errorMessage: 'Cliente do PDF não foi localizado na coluna I da planilha.',
      details: [
        body.pdfFileName ? `PDF: ${body.pdfFileName}` : null,
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
      clientName: body.pdfFileName || 'PDF',
      status: 'pre_visualizacao',
      action: 'dry_run',
      sources: [],
      errorMessage: '',
      details: 'Prévia executada sem gravar alterações na aba principal. DATA DA ATUALIZAÇÃO só muda em execução real.',
      cardUrl: '',
    })
  }

  let updateFailureMessage = ''
  if (!dryRun && updateRequests.length > 0) {
    try {
      await sheets.batchUpdateValues(updateRequests)
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

  await sheets.appendLogRows(logEntries.map(buildLogRow))

  if (updateFailureMessage) {
    throw new Error(updateFailureMessage)
  }

  return {
    dryRun,
    sheetName,
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
