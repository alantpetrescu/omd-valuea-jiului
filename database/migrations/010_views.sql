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
