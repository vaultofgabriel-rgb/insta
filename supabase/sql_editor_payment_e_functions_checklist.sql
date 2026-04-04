-- =============================================================================
-- Cole no Supabase → SQL Editor → Run
--
-- O QUE ESTE SCRIPT FAZ (banco de dados):
--   Garante linhas em public.settings usadas pelo fluxo de PIX (create-payment).
--
-- O QUE ESTE SCRIPT NÃO FAZ (importante):
--   • NÃO publica Edge Functions (create-payment, check-payment, etc.).
--     Se o app mostra "Failed to send a request to the Edge Function", o
--     problema é rede/deploy — no PC, na pasta do projeto:
--       npm run deploy:functions
--     (ou npm.cmd run deploy:functions no PowerShell com política de scripts.)
--   • NÃO configura X_MERCHANT_KEY / SKALE_API_KEY — isso é em
--     Project Settings → Edge Functions → Secrets.
-- =============================================================================

INSERT INTO public.settings (key, value) VALUES
  ('payment_gateway', 'x'),
  ('smm_service_id', '472')
ON CONFLICT (key) DO NOTHING;

-- Gateway: 'x' = ExPay (PIX link). Para Skale no admin, o app grava 'skale' aqui.
-- Se payment_gateway estiver vazio/errado, ajuste manualmente se precisar:
-- UPDATE public.settings SET value = 'x' WHERE key = 'payment_gateway';

-- Opcional: quantidade mínima de seguidores (create-payment lê se existir).
-- Sem esta chave, o mínimo não é aplicado.
INSERT INTO public.settings (key, value) VALUES
  ('smm_min_followers', '1')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Checklist rápido (fora do SQL)
-- =============================================================================
-- [ ] Edge Functions deployadas: create-payment, payment-webhook, check-payment,
--     process-queue, fetch-profile
-- [ ] Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (geralmente automáticos)
-- [ ] PIX ExPay: X_MERCHANT_KEY ou EXPAY_MERCHANT_KEY
-- [ ] PIX Skale: SKALE_API_KEY + payment_gateway = skale em settings
-- [ ] Tabelas orders, packages, settings (use sql_editor_ALL_IN_ONE.sql se for DB novo)
-- =============================================================================
