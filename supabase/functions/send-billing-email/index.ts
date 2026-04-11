import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function formatClientName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
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

      const personalizedMessage = (messageTemplate || '')
        .replace(/\{nome\}/g, clientName)
        .replace(/\{valor\}/g, formattedAmount)
        .replace(/\{vencimento\}/g, rec.due_date)

      const htmlBody = `
        <div style="background: #f3f5f8; padding: 32px 16px; font-family: Arial, sans-serif;">
          <div style="max-width: 620px; margin: 0 auto; overflow: hidden; border-radius: 18px; background: #ffffff; border: 1px solid #d9dee7; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);">
            <div style="background: linear-gradient(135deg, #182235 0%, #25344f 100%); padding: 28px 32px;">
              <div style="display: flex; align-items: center; gap: 16px;">
                ${
                  logoUrl
                    ? `<div style="width: 64px; height: 64px; border-radius: 16px; background: #ffffff; padding: 8px; box-sizing: border-box;">
                         <img src="${logoUrl}" alt="Modaelli" style="display: block; width: 48px; height: 48px; object-fit: contain;" />
                       </div>`
                    : `<div style="width: 64px; height: 64px; border-radius: 16px; background: #ffffff; color: #182235; font-size: 28px; font-weight: 700; line-height: 64px; text-align: center;">
                         M
                       </div>`
                }
                <div>
                  <div style="font-size: 12px; letter-spacing: 1.6px; text-transform: uppercase; color: #c8d3e6; font-weight: 700;">Modaelli Advogados</div>
                  <h1 style="margin: 8px 0 0; color: #ffffff; font-size: 28px; line-height: 1.2;">Lembrete de vencimento</h1>
                </div>
              </div>
              <p style="margin: 8px 0 0; color: #d6deec; font-size: 15px; line-height: 1.6;">
                Comunicamos abaixo os dados para regularizacao do contrato de honorarios junto ao escritorio.
              </p>
            </div>
            <div style="padding: 28px 32px 16px;">
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; margin-bottom: 24px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 0 0 10px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px;">Cliente</td>
                    <td style="padding: 0 0 10px; color: #0f172a; font-size: 16px; font-weight: 700; text-align: right;">${clientName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; border-top: 1px solid #e2e8f0;">Valor</td>
                    <td style="padding: 10px 0; color: #0f172a; font-size: 22px; font-weight: 700; text-align: right; border-top: 1px solid #e2e8f0;">R$ ${formattedAmount}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; border-top: 1px solid #e2e8f0;">Vencimento</td>
                    <td style="padding: 10px 0 0; color: #b45309; font-size: 16px; font-weight: 700; text-align: right; border-top: 1px solid #e2e8f0;">${rec.due_date}</td>
                  </tr>
                </table>
              </div>
              <div style="color: #334155; font-size: 15px; line-height: 1.8; white-space: pre-line;">${personalizedMessage}</div>
              <div style="margin-top: 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px;">
                <div style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 8px;">Dados para pagamento via PIX</div>
                <div style="color: #0f172a; font-size: 14px; line-height: 1.8;">
                  <strong>Favorecido:</strong> Modaelli Sociedade de Advogados<br />
                  <strong>CNPJ:</strong> 48.697.725/0001-07<br />
                  <strong>Identificacao no banco:</strong> Grupo MMM ou Grupo M Intermediacoes
                </div>
              </div>
            </div>
            <div style="padding: 0 32px 28px;">
              <div style="border-top: 1px solid #e2e8f0; padding-top: 18px; color: #64748b; font-size: 13px; line-height: 1.7;">
                Em caso de divergencia, pagamento ja realizado ou necessidade de suporte, entre em contato com nossa equipe financeira e encaminhe o comprovante para baixa no sistema.
              </div>
            </div>
          </div>
          <p style="max-width: 620px; margin: 16px auto 0; text-align: center; font-size: 11px; color: #94a3b8;">
            Mensagem automatica enviada por Modaelli. Por favor, nao responda este e-mail.
          </p>
        </div>
      `

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
            subject: `Modaelli | Aviso de cobranca - vencimento ${rec.due_date}`,
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
          throw new Error(`Falha ao registrar cobranca enviada: ${billingInsertError.message}`)
        }

        const { error: emailLogInsertError } = await adminSupabase.from('email_logs').insert({
          client_name: rec.client_name,
          client_email: rec.client_email,
          amount: rec.amount,
          due_date: rec.due_date,
          status: 'sent',
        })

        if (emailLogInsertError) {
          throw new Error(`Falha ao registrar historico de envio: ${emailLogInsertError.message}`)
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
