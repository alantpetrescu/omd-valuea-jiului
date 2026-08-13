-- OMD Valea Jiului migration: Assets, campaign templates and template assets
-- Generated verbatim from 02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql
-- (sha256 d76b645f05c47707e9edba44cf922dad36b95341ea2b22ea59969c3f402978f4).
-- Do not edit in place: schema changes go into a new numbered migration.

CREATE TABLE assets (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(127) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  storage_path VARCHAR(1000) NOT NULL,
  checksum_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assets_external_key (external_key),
  KEY idx_assets_checksum (checksum_sha256),
  KEY idx_assets_deleted (deleted_at),
  CONSTRAINT fk_assets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_assets_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_assets_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campaign_templates (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  campaign_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name VARCHAR(500) NOT NULL,
  formats_text TEXT NOT NULL,
  structure_text TEXT NOT NULL,
  is_generic TINYINT(1) NOT NULL DEFAULT 0,
  canva_url VARCHAR(1000) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_templates_external_key (external_key),
  KEY idx_campaign_templates_campaign (campaign_id, deleted_at),
  CONSTRAINT fk_campaign_templates_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_campaign_templates_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_campaign_templates_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_campaign_templates_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_campaign_templates_generic CHECK (is_generic IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campaign_template_assets (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  campaign_template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  format_text VARCHAR(255) NOT NULL,
  label VARCHAR(500) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_template_assets_external_key (external_key),
  UNIQUE KEY uq_campaign_template_assets_pair (campaign_template_id, asset_id),
  KEY idx_campaign_template_assets_asset (asset_id),
  CONSTRAINT fk_campaign_template_assets_template FOREIGN KEY (campaign_template_id) REFERENCES campaign_templates(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_campaign_template_assets_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_campaign_template_assets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_campaign_template_assets_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_campaign_template_assets_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
