-- =============================================================================
-- Só pacotes que VOCÊ cadastrar no admin (seguidores)
-- =============================================================================
-- A home e o checkout leem a tabela public.packages (kind = 'followers').
-- O arquivo sql_editor_ALL_IN_ONE.sql (e migrações antigas) INSEREM pacotes
-- exemplo (ex.: 500 seguidores com R$ 149,90 / promo R$ 99,90). Por isso
-- aparecem valores que você não digitou no painel — eles já estavam no banco.
--
-- Este script APAGA todos os pacotes de SEGUIDORES. Depois cadastre só os que
-- quiser em: Admin → Seguidores.
--
-- Não apaga pacotes de curtidas (kind = 'likes').
-- =============================================================================

DELETE FROM public.packages WHERE kind = 'followers';

NOTIFY pgrst, 'reload schema';

-- Opcional: conferir que ficou vazio
-- SELECT * FROM public.packages WHERE kind = 'followers';
