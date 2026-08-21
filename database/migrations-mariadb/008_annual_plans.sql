-- GENERAT AUTOMAT — nu edita acest fișier.
--
-- Sursa: database/migrations/008_annual_plans.sql
-- Comanda: php bin/generate-mariadb-migrations.php
--
-- Singura diferență față de sursă este colația: MySQL 8 folosește
-- `utf8mb4_0900_ai_ci`, care nu există în MariaDB. Echivalentul cel mai apropiat
-- disponibil acolo este `utf8mb4_unicode_520_nopad_ci` — aceeași insensibilitate la diacritice
-- și la majuscule, același tratament NO PAD al spațiilor finale.
--
-- Motivul alegerii e explicat în src/Database/Dialect.php.

-- OMD Valea Jiului migration: Annual plans and their relation tables
-- Generated verbatim from 02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql
-- (sha256 d76b645f05c47707e9edba44cf922dad36b95341ea2b22ea59969c3f402978f4).
-- Do not edit in place: schema changes go into a new numbered migration.

CREATE TABLE annual_plans (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL DEFAULT 1,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_annual_plans_external_key (external_key),
  UNIQUE KEY uq_annual_plans_year (year),
  CONSTRAINT fk_annual_plans_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_annual_plans_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_annual_plans_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_annual_plans_year CHECK (year BETWEEN 2000 AND 2100),
  CONSTRAINT chk_annual_plans_version CHECK (version_number >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;

CREATE TABLE annual_plan_campaigns (
  annual_plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (annual_plan_id, campaign_id),
  KEY idx_annual_plan_campaigns_campaign (campaign_id),
  CONSTRAINT fk_annual_plan_campaigns_plan FOREIGN KEY (annual_plan_id) REFERENCES annual_plans(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_annual_plan_campaigns_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_annual_plan_campaigns_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;

CREATE TABLE annual_plan_activations (
  annual_plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  activation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (annual_plan_id, activation_id),
  KEY idx_annual_plan_activations_activation (activation_id),
  CONSTRAINT fk_annual_plan_activations_plan FOREIGN KEY (annual_plan_id) REFERENCES annual_plans(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_annual_plan_activations_activation FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_annual_plan_activations_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;
