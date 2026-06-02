import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const LOG_SHEET_NAME = 'LOG_AUTOMACAO'
const NOT_FOUND_MESSAGE = 'Não localizado no Trello'
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

type SheetValues = string[][]
type ColumnMap = Record<string, number | undefined>
type AutomationBody = {
  dryRun?: boolean
  maxRows?: number
  startRow?: number
  sheetName?: string
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
type LookupResult = {
  found: boolean
  resultLabel: string
  situation: string
  actionDate: string
  cardUrl: string
  error?: string
}
type ProcessedRow = {
  rowNumber: number
  clientName: string
  resultLabel: string
  situation: string
  actionDate: string
  cardUrl: string
  status: string
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

function normalizeText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
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

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replaceAll("'", "''")}'`
}

function buildHeaderLookup(headers: string[]) {
  const lookup: Record<string, number> = {}
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header)
    if (normalized && lookup[normalized] === undefined) {
      lookup[normalized] = index + 1
    }
  })
  return lookup
}

function findColumn(lookup: Record<string, number>, aliases: string[]) {
  for (const alias of aliases) {
    const normalized = normalizeHeader(alias)
    if (lookup[normalized] !== undefined) return lookup[normalized]
  }
  return undefined
}

function resolveColumns(headers: string[]): ColumnMap {
  const lookup = buildHeaderLookup(headers)
  return {
    cliente: findColumn(lookup, ['Cliente', 'Nome', 'Nome do cliente', 'Cliente / parte']),
    responsavel: findColumn(lookup, ['Responsavel', 'Responsável', 'Resp']),
    materia: findColumn(lookup, ['Materia', 'Matéria']),
    processo: findColumn(lookup, ['Processo']),
    financeiro: findColumn(lookup, ['Financeiro', 'Status financeiro']),
    regua: findColumn(lookup, ['Regua', 'Régua', 'Regua de cobranca', 'Régua de cobrança']),
    vencimento: findColumn(lookup, ['Vencimento', 'Data de vencimento']),
    diasVencido: findColumn(lookup, ['Dias vencido', 'Dias vencidos', 'Dias em atraso']),
    valorAberto: findColumn(lookup, ['Valor aberto', 'Aberto']),
    valorPago: findColumn(lookup, ['Valor pago', 'Pago']),
    valorAVencer: findColumn(lookup, ['Valor a vencer', 'A vencer']),
    resultado: findColumn(lookup, ['Resultado Trello', 'Resultado', 'Status Trello']),
    situacao: findColumn(lookup, ['Situacao da cobranca', 'Situação da cobrança', 'Situacao', 'Situação']),
    dataAcao: findColumn(lookup, ['Data da acao', 'Data da ação', 'Data acao', 'Data ação']),
    dataAtualizacao: findColumn(lookup, ['Data da atualizacao', 'Data da atualização', 'Atualizacao', 'Atualização']),
  }
}

function getCell(row: string[], columnIndex?: number) {
  if (!columnIndex) return ''
  return String(row[columnIndex - 1] || '').trim()
}

function toFloatBrl(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : 0
}

function toInt(value: string) {
  const match = value.match(/-?\d+/)
  return match ? Number(match[0]) : 0
}

function isMonthSeparator(row: string[]) {
  const values = row.map((value) => value.trim()).filter(Boolean)
  if (values.length !== 1) return false
  const normalized = normalizeHeader(values[0])
  return MONTH_NAMES.some((month) => normalized.includes(normalizeHeader(month)))
}

function isValidClientRow(row: string[], columns: ColumnMap) {
  const client = getCell(row, columns.cliente)
  if (!client || isMonthSeparator(row)) return false
  const normalizedClient = normalizeHeader(client)
  if (MONTH_NAMES.some((month) => normalizedClient === normalizeHeader(month))) return false
  return Boolean(
    getCell(row, columns.materia) ||
      getCell(row, columns.processo) ||
      getCell(row, columns.financeiro) ||
      getCell(row, columns.vencimento),
  )
}

function classifyRow(row: string[], columns: ColumnMap) {
  const financeiro = normalizeHeader(getCell(row, columns.financeiro))
  const regua = normalizeHeader(getCell(row, columns.regua))
  const diasVencido = toInt(getCell(row, columns.diasVencido))
  const valorAberto = toFloatBrl(getCell(row, columns.valorAberto))
  const valorPago = toFloatBrl(getCell(row, columns.valorPago))
  const valorAVencer = toFloatBrl(getCell(row, columns.valorAVencer))

  if (financeiro.includes('QUITADO') || valorPago > 0) {
    return { status: 'QUITADO', situation: 'quitado' }
  }

  if (financeiro.includes('ATRAS') || regua.includes('ATRAS') || diasVencido > 0 || valorAberto > 0) {
    return { status: 'EM ATRASO', situation: 'em_atraso' }
  }

  if (valorAVencer > 0) {
    return { status: 'A VENCER', situation: 'a_vencer' }
  }

  return { status: financeiro || 'PENDENTE', situation: 'pendente' }
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

class TrelloService {
  apiKey: string
  token: string
  boardId: string | null
  listIds: Set<string>
  listNameCache = new Map<string, string>()
  baseUrl = 'https://api.trello.com/1'

  constructor(apiKey: string, token: string, boardId: string | null, listIds: string[]) {
    this.apiKey = apiKey
    this.token = token
    this.boardId = boardId
    this.listIds = new Set(listIds.filter(Boolean))
  }

  async get(path: string, params: Record<string, string> = {}) {
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

  async searchClientCard(clientName: string): Promise<LookupResult> {
    try {
      const cards = await this.searchCards(clientName)
      const selected = this.chooseBestCard(clientName, cards)
      if (!selected?.id) {
        return {
          found: false,
          resultLabel: NOT_FOUND_MESSAGE,
          situation: NOT_FOUND_MESSAGE,
          actionDate: '',
          cardUrl: '',
        }
      }

      const detail = await this.getCardDetail(selected.id)
      return {
        found: true,
        resultLabel: 'Localizado no Trello',
        situation: await this.summarizeSituation(detail),
        actionDate: extractActionDate(detail),
        cardUrl: detail.shortUrl || detail.url || '',
      }
    } catch (error) {
      return {
        found: false,
        resultLabel: 'Erro ao consultar Trello',
        situation: error instanceof Error ? error.message : 'Erro desconhecido no Trello',
        actionDate: '',
        cardUrl: '',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      }
    }
  }

  async searchCards(clientName: string): Promise<TrelloCard[]> {
    const params: Record<string, string> = {
      query: clientName,
      modelTypes: 'cards',
      card_fields: 'name,desc,idBoard,idList,shortUrl,url,due,dateLastActivity,closed',
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
    const clientTokens = new Set(normalizeText(clientName).split(' ').filter(Boolean))

    function score(card: TrelloCard) {
      const name = normalizeText(card.name)
      const description = normalizeText(card.desc)
      const nameTokens = new Set(name.split(' ').filter(Boolean))
      const descriptionTokens = new Set(description.split(' ').filter(Boolean))
      const sharedName = [...clientTokens].filter((token) => nameTokens.has(token)).length
      const sharedDescription = [...clientTokens].filter((token) => descriptionTokens.has(token)).length
      const exactBoost = name.includes(normalizeText(clientName)) ? 100 : 0
      return exactBoost + sharedName * 10 + sharedDescription * 2
    }

    return cards.sort((a, b) => score(b) - score(a))[0]
  }

  async getCardDetail(cardId: string): Promise<TrelloCard> {
    return this.get(`/cards/${cardId}`, {
      fields: 'name,desc,idList,shortUrl,url,due,dateLastActivity,labels',
      actions: 'commentCard,updateCard:idList',
      actions_limit: '40',
    })
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
    const pieces: string[] = []
    const listName = await this.getListName(card.idList)
    if (listName) pieces.push(`Lista: ${listName}`)
    const labels = (card.labels || []).map((label) => label.name).filter(Boolean)
    if (labels.length > 0) pieces.push(`Etiquetas: ${labels.join(', ')}`)
    const latestComment = (card.actions || []).find((action) => action.type === 'commentCard')?.data?.text
    if (latestComment) pieces.push(`Ultima acao: ${latestComment.replace(/\s+/g, ' ').trim()}`)
    if (card.due) pieces.push(`Prazo: ${new Date(card.due).toLocaleDateString('pt-BR')}`)
    return pieces.join(' | ')
  }
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

  async ensureLogSheet() {
    const metadata = await this.request('?fields=sheets.properties.title')
    const exists = (metadata.sheets || []).some((sheet: { properties?: { title?: string } }) => sheet.properties?.title === LOG_SHEET_NAME)
    if (!exists) {
      await this.request(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: LOG_SHEET_NAME } } }],
        }),
      })
      await this.updateValues(`${quoteSheetName(LOG_SHEET_NAME)}!A1:G1`, [
        ['Data/hora', 'Linha', 'Cliente', 'Resultado', 'Situação', 'Data da ação', 'Card Trello'],
      ])
    }
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
    if (rows.length === 0) return
    await this.request(`/values/${encodeURIComponent(`${quoteSheetName(LOG_SHEET_NAME)}!A:G`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    })
  }
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
  if (rpcError || !data) throw new Error(requireAdmin ? 'Apenas administradores podem executar a automacao.' : 'Usuario nao aprovado.')
}

async function runAutomation(req: Request) {
  await assertCanRun(req)

  const body = (await req.json().catch(() => ({}))) as AutomationBody
  const dryRun = Boolean(body.dryRun)
  const spreadsheetId = Deno.env.get('GOOGLE_SPREADSHEET_ID')
  const sheetName = String(body.sheetName || Deno.env.get('GOOGLE_SHEET_NAME') || 'Externos')
  const maxRows = body.maxRows && Number.isFinite(Number(body.maxRows)) ? Number(body.maxRows) : Number(Deno.env.get('MAX_ROWS') || 0)
  const startRow = Math.max(2, body.startRow && Number.isFinite(Number(body.startRow)) ? Number(body.startRow) : Number(Deno.env.get('START_ROW') || 2))
  const trelloApiKey = Deno.env.get('TRELLO_API_KEY')
  const trelloToken = Deno.env.get('TRELLO_TOKEN')
  const trelloBoardId = Deno.env.get('TRELLO_BOARD_ID') || null
  const trelloListIds = (Deno.env.get('TRELLO_LIST_IDS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const missing = [
    !spreadsheetId ? 'GOOGLE_SPREADSHEET_ID' : null,
    !trelloApiKey ? 'TRELLO_API_KEY' : null,
    !trelloToken ? 'TRELLO_TOKEN' : null,
  ].filter(Boolean)
  if (missing.length > 0) throw new Error(`Variaveis obrigatorias ausentes: ${missing.join(', ')}`)

  const accessToken = await getGoogleAccessToken()
  const sheets = new GoogleSheetsService(spreadsheetId!, accessToken)
  const trello = new TrelloService(trelloApiKey!, trelloToken!, trelloBoardId, trelloListIds)
  const values = await sheets.readSheetValues(sheetName)
  if (values.length < 2) throw new Error(`A aba ${sheetName} nao possui linhas suficientes.`)

  const headers = values[0] || []
  const columns = resolveColumns(headers)
  if (!columns.cliente) throw new Error('Coluna obrigatoria nao encontrada: Cliente')

  const outputColumns = { ...columns }
  const headerUpdates: Array<{ range: string; values: SheetValues }> = []
  let nextColumn = headers.length + 1
  for (const [key, label] of Object.entries({
    resultado: 'Resultado Trello',
    situacao: 'Situação da cobrança',
    dataAcao: 'Data da ação',
    dataAtualizacao: 'Data da atualização',
  })) {
    if (!outputColumns[key]) {
      outputColumns[key] = nextColumn
      headerUpdates.push({
        range: `${quoteSheetName(sheetName)}!${columnLetter(nextColumn)}1`,
        values: [[label]],
      })
      nextColumn += 1
    }
  }

  const now = new Date()
  const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const updateRequests: Array<{ range: string; values: SheetValues }> = []
  const logRows: SheetValues = []
  const processed: ProcessedRow[] = []
  let skipped = 0

  const rows = values.slice(startRow - 1)
  for (let index = 0; index < rows.length; index += 1) {
    if (maxRows > 0 && processed.length >= maxRows) break
    const row = rows[index]
    const rowNumber = index + startRow
    if (!isValidClientRow(row, columns)) {
      skipped += 1
      continue
    }

    const clientName = getCell(row, columns.cliente)
    const classification = classifyRow(row, columns)
    const lookup = await trello.searchClientCard(clientName)
    const resultLabel = lookup.resultLabel
    const situation = lookup.found ? lookup.situation || classification.situation : lookup.situation
    const actionDate = lookup.actionDate
    const cardUrl = lookup.cardUrl

    for (const [key, value] of Object.entries({
      resultado: resultLabel,
      situacao: situation,
      dataAcao: actionDate,
      dataAtualizacao: timestamp,
    })) {
      const column = outputColumns[key]
      if (!column) continue
      updateRequests.push({
        range: `${quoteSheetName(sheetName)}!${columnLetter(column)}${rowNumber}`,
        values: [[value]],
      })
    }

    logRows.push([timestamp, String(rowNumber), clientName, resultLabel, situation, actionDate, cardUrl])
    processed.push({
      rowNumber,
      clientName,
      resultLabel,
      situation,
      actionDate,
      cardUrl,
      status: classification.status,
    })
  }

  if (!dryRun) {
    await sheets.batchUpdateValues([...headerUpdates, ...updateRequests])
    await sheets.ensureLogSheet()
    await sheets.appendLogRows(logRows)
  }

  const found = processed.filter((row) => row.resultLabel === 'Localizado no Trello').length
  const notFound = processed.filter((row) => row.resultLabel === NOT_FOUND_MESSAGE).length
  const errors = processed.filter((row) => row.resultLabel === 'Erro ao consultar Trello').length

  return {
    dryRun,
    sheetName,
    startRow,
    processed: processed.length,
    skipped,
    found,
    notFound,
    errors,
    updatedCells: dryRun ? 0 : updateRequests.length + headerUpdates.length,
    logRows: dryRun ? 0 : logRows.length,
    preview: processed.slice(0, 15),
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
