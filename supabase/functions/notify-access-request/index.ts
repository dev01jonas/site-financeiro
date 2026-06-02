const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

  try {
    const { email, fullName, origin } = await req.json()
    const adminEmail = Deno.env.get('ADMIN_APPROVAL_EMAIL') || 'advogadosmodaelli06@gmail.com'
    const rawFromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'
    const fromEmail = rawFromEmail.includes('<') ? rawFromEmail : `Modaelli Advogados <${rawFromEmail}>`

    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'E-mail do solicitante n?o informado.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const safeEmail = escapeHtml(email.trim())
    const safeName = escapeHtml((fullName || '').trim() || 'Nome n?o informado')
    const accessUrl = origin ? `${origin}/acessos` : null

    const html = `
      <div style="background:#f3f5f8;padding:32px 16px;font-family:Arial,sans-serif;">
        <div style="max-width:620px;margin:0 auto;overflow:hidden;border-radius:18px;background:#ffffff;border:1px solid #d9dee7;box-shadow:0 18px 45px rgba(15,23,42,0.08);">
          <div style="background:linear-gradient(135deg,#182235 0%,#25344f 100%);padding:28px 32px;">
            <div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#c8d3e6;font-weight:700;">Modaelli Advogados</div>
            <h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;line-height:1.2;">Nova solicitacao de acesso</h1>
            <p style="margin:8px 0 0;color:#d6deec;font-size:15px;line-height:1.6;">
              Um novo cadastro foi criado no sistema financeiro e aguarda sua analise.
            </p>
          </div>
          <div style="padding:28px 32px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 10px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.8px;">Nome</td>
                  <td style="padding:0 0 10px;color:#0f172a;font-size:16px;font-weight:700;text-align:right;">${safeName}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.8px;border-top:1px solid #e2e8f0;">E-mail</td>
                  <td style="padding:10px 0 0;color:#0f172a;font-size:16px;font-weight:700;text-align:right;border-top:1px solid #e2e8f0;">${safeEmail}</td>
                </tr>
              </table>
            </div>
            <p style="margin:24px 0 0;color:#334155;font-size:15px;line-height:1.8;">
              Entre na area de acessos para aprovar ou reprovar esta solicitacao.
            </p>
            ${
              accessUrl
                ? `<div style="margin-top:20px;">
                     <a href="${accessUrl}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#21395d;color:#ffffff;text-decoration:none;font-weight:700;">
                       Revisar acessos
                     </a>
                   </div>`
                : ''
            }
          </div>
        </div>
      </div>
    `

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [adminEmail],
        subject: 'Modaelli | Nova solicitacao de acesso',
        html,
      }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `API error [${response.status}]: ${JSON.stringify(data)}` }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
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
