import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPPORT_PHONE = '2364-4647'
const INSTAGRAM_URL = 'https://www.instagram.com/modaelliadvogados'

function formatClientName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildEmailHtml({
  clientName,
  dueDate,
  formattedAmount,
  personalizedMessage,
  logoUrl,
}: {
  clientName: string
  dueDate: string
  formattedAmount: string
  personalizedMessage: string
  logoUrl: string | null
}) {
  const safeClientName = escapeHtml(clientName)
  const safeDueDate = escapeHtml(dueDate)

  return `
    <!DOCTYPE html>
    <html lang="pt-BR" translate="no" class="notranslate">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="google" content="notranslate" />
      <title>Modaelli | Aviso de cobrança</title>
    </head>
    <body translate="no" class="notranslate" style="margin:0;padding:0;background:#eef2f7;">
      <div translate="no" class="notranslate" style="margin:0;padding:28px 14px;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#172033;">
        <div style="max-width:680px;margin:0 auto;">
          <div style="overflow:hidden;border-radius:22px;background:#ffffff;border:1px solid #d9e2ef;box-shadow:0 22px 58px rgba(23,32,51,0.10);">
            <div style="background:#172842;padding:30px 32px 28px;">
              <table role="presentation" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="width:86px;vertical-align:top;">
                    ${
                      logoUrl
                        ? `<div style="width:72px;height:72px;border-radius:18px;background:#ffffff;padding:10px;box-sizing:border-box;">
                             <img src="${logoUrl}" alt="Modaelli Advogados" style="display:block;width:52px;height:52px;object-fit:contain;" />
                           </div>`
                        : `<div style="width:72px;height:72px;border-radius:18px;background:#ffffff;color:#172842;font-size:30px;font-weight:700;line-height:72px;text-align:center;">M</div>`
                    }
                  </td>
                  <td style="vertical-align:top;padding-left:18px;">
                    <div style="display:inline-block;margin-bottom:10px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.10);border:1px solid rgba(230,237,247,0.18);color:#d8e4f2;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">
                      Modaelli Advogados
                    </div>
                    <h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.15;font-weight:700;">
                      Aviso de cobrança
                    </h1>
                    <p style="margin:10px 0 0;color:#d8e4f2;font-size:14px;line-height:1.65;">
                      Comunicação financeira institucional com canais oficiais de atendimento.
                    </p>
                  </td>
                </tr>
              </table>
            </div>

            <div style="padding:26px 30px 8px;">
              <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 10px;">
                <tr>
                  <td style="padding:18px 18px;border:1px solid #dbe4ef;border-radius:16px;background:#f8fafc;">
                    <div style="font-size:11px;color:#6d7d94;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px;">Cliente</div>
                    <div style="font-size:18px;line-height:1.35;color:#172033;font-weight:700;">${safeClientName}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:10px 0;margin:0 -10px 20px;">
                <tr>
                  <td style="width:50%;padding:18px;border:1px solid #dbe4ef;border-radius:16px;background:#ffffff;">
                    <div style="font-size:11px;color:#6d7d94;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">Valor</div>
                    <div style="font-size:26px;line-height:1.2;color:#172033;font-weight:700;">R$ ${formattedAmount}</div>
                  </td>
                  <td style="width:50%;padding:18px;border:1px solid #f0d39b;border-radius:16px;background:#fff8ec;">
                    <div style="font-size:11px;color:#7b5a17;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">Vencimento</div>
                    <div style="font-size:22px;line-height:1.2;color:#8a5b00;font-weight:700;">${safeDueDate}</div>
                  </td>
                </tr>
              </table>

              <div style="border:1px solid #dbe4ef;border-radius:16px;background:#ffffff;padding:22px;margin-bottom:18px;">
                <div style="font-size:11px;color:#6d7d94;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:12px;">Mensagem</div>
                <div style="color:#2f405b;font-size:15px;line-height:1.85;">${personalizedMessage}</div>
              </div>

              <div style="border:1px solid #dbe4ef;border-radius:16px;background:#f7fafc;padding:22px;margin-bottom:18px;">
                <div style="font-size:11px;color:#6d7d94;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:12px;">Dados para pagamento via PIX</div>
                <div style="color:#172033;font-size:14px;line-height:1.85;">
                  <strong>Favorecido:</strong> Modaelli Sociedade de Advogados<br />
                  <strong>CNPJ / Chave PIX:</strong> 48.697.725/0001-07<br />
                  <strong>Identificação no banco:</strong> Grupo MMM ou Grupo M Intermediações
                </div>
              </div>

              <div style="border-radius:16px;background:#172842;padding:20px 22px;color:#e8eff8;margin-bottom:20px;">
                <div style="font-size:11px;color:#b9c9dc;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:10px;">Central de atendimento</div>
                <div style="font-size:15px;line-height:1.85;">
                  <strong>Telefone:</strong> <a href="tel:${SUPPORT_PHONE}" style="color:#ffffff;text-decoration:none;">${SUPPORT_PHONE}</a><br />
                  <strong>Instagram:</strong> <a href="${INSTAGRAM_URL}" target="_blank" rel="noreferrer" style="color:#ffffff;text-decoration:none;">@modaelliadvogados</a>
                </div>
              </div>

              <div style="border-top:1px solid #dbe4ef;padding:18px 0 4px;color:#6d7d94;font-size:12px;line-height:1.75;">
                Em caso de divergência, pagamento já realizado ou necessidade de suporte, entre em contato com nossa equipe financeira e encaminhe o comprovante para baixa no sistema.
              </div>
            </div>
          </div>

          <p style="max-width:620px;margin:14px auto 0;text-align:center;font-size:11px;color:#788ba5;line-height:1.6;">
            Mensagem automática enviada por Modaelli Advogados. Para atendimento, utilize o telefone ${SUPPORT_PHONE} ou o Instagram oficial.
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const origin = req.headers.get('origin')
    const { records, messageTemplate } = await req.json()

    if (!records || !Array.isArray(records) || records.length === 0) {
      return new Response(JSON.stringify({ error: 'No records provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const rawFromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'
    const fromEmail = rawFromEmail.includes('<') ? rawFromEmail : `Modaelli Advogados <${rawFromEmail}>`
    const logoUrl = Deno.env.get('EMAIL_LOGO_URL') || (origin ? `${origin}/modaelli-email-logo.jpg` : null)
    const results: { email: string; success: boolean; error?: string }[] = []

    for (const rec of records) {
      if (!rec.client_email) continue

      const clientName = formatClientName(rec.client_name)
      const formattedAmount = rec.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      const personalizedMessage = escapeHtml(
        String(messageTemplate || '')
          .replace(/\{nome\}/g, clientName)
          .replace(/\{valor\}/g, formattedAmount)
          .replace(/\{vencimento\}/g, rec.due_date),
      ).replace(/\n/g, '<br />')

      const htmlBody = buildEmailHtml({
        clientName,
        dueDate: rec.due_date,
        formattedAmount,
        personalizedMessage,
        logoUrl,
      })

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [rec.client_email],
            subject: `Modaelli | Aviso de cobrança - vencimento ${rec.due_date}`,
            html: htmlBody,
          }),
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          results.push({
            email: rec.client_email,
            success: false,
            error: `API error [${response.status}]: ${JSON.stringify(data)}`,
          })
          continue
        }

        const { error: billingInsertError } = await adminSupabase.from('billing_records').insert({
          client_name: rec.client_name,
          client_email: rec.client_email,
          due_date: rec.due_date,
          amount: rec.amount,
          status: 'sent',
          message_template: messageTemplate,
        })

        if (billingInsertError) {
          throw new Error(`Falha ao registrar cobrança enviada: ${billingInsertError.message}`)
        }

        const { error: emailLogInsertError } = await adminSupabase.from('email_logs').insert({
          client_name: rec.client_name,
          client_email: rec.client_email,
          amount: rec.amount,
          due_date: rec.due_date,
          status: 'sent',
        })

        if (emailLogInsertError) {
          throw new Error(`Falha ao registrar histórico de envio: ${emailLogInsertError.message}`)
        }

        results.push({ email: rec.client_email, success: true })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        results.push({ email: rec.client_email, success: false, error: msg })
      }
    }

    const sent = results.filter((result) => result.success).length
    const failed = results.filter((result) => !result.success).length

    return new Response(JSON.stringify({ sent, failed, results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
