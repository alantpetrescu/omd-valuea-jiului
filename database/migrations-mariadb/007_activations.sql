-- GENERAT AUTOMAT — nu edita acest fișier.
--
-- Sursa: database/migrations/007_activations.sql
-- Comanda: php bin/generate-mariadb-migrations.php
--
-- Singura diferență față de sursă este colația: MySQL 8 folosește
-- `utf8mb4_0900_ai_ci`, care nu există în MariaDB. Echivalentul cel mai apropiat
-- disponibil acolo este `utf8mb4_unicode_520_nopad_ci` — aceeași insensibilitate la diacritice
-- și la majuscule, același tratament NO PAD al spațiilor finale.
--
-- Motivul alegerii e explicat în src/Database/Dialect.php.

-- OMD Valea Jiului migration: Activations and their child tables
-- Generated verbatim from 02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql
-- (sha256 d76b645f05c47707e9edba44cf922dad36b95341ea2b22ea59969c3f402978f4).
-- Do not edit in place: schema changes go into a new numbered migration.

CREATE TABLE activations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  strategy_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  pillar_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  title VARCHAR(500) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  responsible VARCHAR(255) NOT NULL,
  planned_budget DECIMAL(15,2) NULL,
  actual_spend DECIMAL(15,2) NULL,
  implementation_mode_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  implementation_partners TEXT NOT NULL,
  objective TEXT NOT NULL,
  products JSON NOT NULL,
  zone VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  landing_url VARCHAR(1000) NOT NULL,
  result_summary TEXT NOT NULL,
  what_worked TEXT NOT NULL,
  recommendation VARCHAR(255) NOT NULL,
  source_created_at_raw VARCHAR(64) NOT NULL,
  source_updated_at_raw VARCHAR(64) NOT NULL,
  version_number INT UNSIGNED NOT NULL DEFAULT 1,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activations_external_key (external_key),
  KEY idx_activations_strategy_version (strategy_version_id, deleted_at),
  KEY idx_activations_campaign (campaign_id, deleted_at),
  KEY idx_activations_status (status_id, deleted_at),
  KEY idx_activations_dates (start_date, end_date),
  KEY idx_activations_pillar (pillar_id),
  CONSTRAINT fk_activations_strategy_version FOREIGN KEY (strategy_version_id) REFERENCES strategy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activations_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activations_pillar FOREIGN KEY (pillar_id) REFERENCES strategic_pillars(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activations_status FOREIGN KEY (status_id) REFERENCES campaign_statuses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activations_implementation_mode FOREIGN KEY (implementation_mode_id) REFERENCES implementation_modes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activations_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_activations_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_activations_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_activations_dates CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT chk_activations_planned_budget CHECK (planned_budget IS NULL OR planned_budget >= 0),
  CONSTRAINT chk_activations_actual_spend CHECK (actual_spend IS NULL OR actual_spend >= 0),
  CONSTRAINT chk_activations_products_json CHECK (JSON_TYPE(products) = 'ARRAY'),
  CONSTRAINT chk_activations_version CHECK (version_number >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;

CREATE TABLE activation_audiences (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  activation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  audience_segment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  custom_label VARCHAR(500) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_activation_audiences_activation (activation_id),
  KEY idx_activation_audiences_segment (audience_segment_id),
  CONSTRAINT fk_activation_audiences_activation FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_audiences_segment FOREIGN KEY (audience_segment_id) REFERENCES audience_segments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_audiences_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_activation_audience_xor CHECK (
    (audience_segment_id IS NOT NULL AND (custom_label IS NULL OR CHAR_LENGTH(TRIM(custom_label)) = 0))
    OR
    (audience_segment_id IS NULL AND custom_label IS NOT NULL AND CHAR_LENGTH(TRIM(custom_label)) > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;

CREATE TABLE activation_funding_sources (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  activation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  funding_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  custom_label VARCHAR(500) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_activation_funding_activation (activation_id),
  KEY idx_activation_funding_type (funding_type_id),
  CONSTRAINT fk_activation_funding_activation FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_funding_type FOREIGN KEY (funding_type_id) REFERENCES funding_types(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_funding_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_activation_funding_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;

CREATE TABLE activation_materials (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  activation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  title VARCHAR(500) NOT NULL,
  channel_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  channel_raw VARCHAR(255) NOT NULL,
  other_channel VARCHAR(255) NOT NULL,
  format_text VARCHAR(255) NOT NULL,
  budget_allocated DECIMAL(15,2) NULL,
  run_start_date DATE NULL,
  run_end_date DATE NULL,
  visual_name VARCHAR(500) NOT NULL,
  visual_canva_url VARCHAR(1000) NOT NULL,
  own_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  copy_text TEXT NOT NULL,
  public_url VARCHAR(1000) NOT NULL,
  platform_external_id VARCHAR(191) NOT NULL,
  template_campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  campaign_template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  campaign_template_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activation_materials_external_key (external_key),
  KEY idx_activation_materials_activation (activation_id, deleted_at),
  KEY idx_activation_materials_channel (channel_id),
  KEY idx_activation_materials_platform (channel_id, platform_external_id),
  KEY idx_activation_materials_template (campaign_template_id),
  KEY idx_activation_materials_template_asset (campaign_template_asset_id),
  CONSTRAINT fk_activation_materials_activation FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_channel FOREIGN KEY (channel_id) REFERENCES activation_channels(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_own_asset FOREIGN KEY (own_asset_id) REFERENCES assets(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_template_campaign FOREIGN KEY (template_campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_template FOREIGN KEY (campaign_template_id) REFERENCES campaign_templates(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_template_asset FOREIGN KEY (campaign_template_asset_id) REFERENCES campaign_template_assets(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_materials_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_activation_material_budget CHECK (budget_allocated IS NULL OR budget_allocated >= 0),
  CONSTRAINT chk_activation_material_dates CHECK (run_start_date IS NULL OR run_end_date IS NULL OR run_end_date >= run_start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;

CREATE TABLE activation_kpis (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  activation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  name VARCHAR(500) NOT NULL,
  target_text TEXT NOT NULL,
  result_text TEXT NOT NULL,
  source_text VARCHAR(500) NOT NULL,
  collection_text VARCHAR(255) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activation_kpis_external_key (external_key),
  KEY idx_activation_kpis_activation (activation_id, deleted_at),
  CONSTRAINT fk_activation_kpis_activation FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_kpis_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_kpis_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_activation_kpis_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_activation_kpis_enabled CHECK (enabled IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_nopad_ci;
