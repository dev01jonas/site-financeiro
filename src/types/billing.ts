export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  created_at?: string;
}

export interface BillingRecord {
  id: string;
  client_name: string;
  due_date: string;
  amount: number;
  created_at?: string;
  client_id?: string;
  client_email?: string;
  status: 'matched' | 'unmatched' | 'sent' | 'overdue';
  payment_method?: 'pix' | 'boleto' | null;
  payment_status?: 'pending' | 'paid' | 'cancelled' | null;
  payment_notes?: string | null;
  paid_at?: string | null;
  pix_key?: string | null;
  pix_copy_paste?: string | null;
  boleto_reference?: string | null;
  collection_stage?: 'nova' | 'em_cobranca' | 'aguardando_pagamento' | 'paga' | 'atrasada' | 'cancelada' | null;
  priority?: 'baixa' | 'media' | 'alta' | null;
  assigned_to?: string | null;
  last_contact_at?: string | null;
  contact_attempts?: number | null;
}

export interface EmailLog {
  id: string;
  client_name: string;
  client_email: string;
  amount: number;
  due_date: string;
  sent_at: string;
  status: 'sent' | 'failed';
}
