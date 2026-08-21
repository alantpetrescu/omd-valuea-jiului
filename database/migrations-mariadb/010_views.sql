-- GENERAT AUTOMAT — nu edita acest fișier.
--
-- Sursa: database/migrations/010_views.sql
-- Comanda: php bin/generate-mariadb-migrations.php
--
-- Singura diferență față de sursă este colația: MySQL 8 folosește
-- `utf8mb4_0900_ai_ci`, care nu există în MariaDB. Echivalentul cel mai apropiat
-- disponibil acolo este `utf8mb4_unicode_520_nopad_ci` — aceeași insensibilitate la diacritice
-- și la majuscule, același tratament NO PAD al spațiilor finale.
--
-- Motivul alegerii e explicat în src/Database/Dialect.php.

-- OMD Valea Jiului migration: Derived views
-- Generated verbatim from 02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql
-- (sha256 d76b645f05c47707e9edba44cf922dad36b95341ea2b22ea59969c3f402978f4).
-- Do not edit in place: schema changes go into a new numbered migration.

CREATE VIEW v_annual_plan_effective_campaigns AS
SELECT
  apc.annual_plan_id,
  apc.campaign_id
FROM annual_plan_campaigns apc
UNION
SELECT
  apa.annual_plan_id,
  a.campaign_id
FROM annual_plan_activations apa
JOIN activations a ON a.id = apa.activation_id
WHERE a.campaign_id IS NOT NULL;
