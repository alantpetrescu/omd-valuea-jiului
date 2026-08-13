-- OMD Valea Jiului migration: Import batches and audit log
-- Generated verbatim from 02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql
-- (sha256 d76b645f05c47707e9edba44cf922dad36b95341ea2b22ea59969c3f402978f4).
-- Do not edit in place: schema changes go into a new numbered migration.

CREATE TABLE import_batches (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  package_type VARCHAR(64) NOT NULL,
  package_id VARCHAR(191) NULL,
  schema_version VARCHAR(20) NULL,
  filename VARCHAR(255) NULL,
  checksum_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  source VARCHAR(500) NULL,
  purpose VARCHAR(32) NULL,
  application VARCHAR(191) NULL,
  notes TEXT NULL,
  generated_at DATETIME(6) NULL,
  reporting_label VARCHAR(255) NULL,
  reporting_start_date DATE NULL,
  reporting_end_date DATE NULL,
  dependencies_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  created_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  report_json JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_import_batches_package (package_type, package_id),
  KEY idx_import_batches_status (status, started_at),
  KEY idx_import_batches_user (created_by),
  CONSTRAINT fk_import_batches_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_import_package_type CHECK (package_type IN (
    'OMD_CAMPAIGNS_PACKAGE',
    'OMD_ACTIVATIONS_PACKAGE',
    'OMD_ACTIVATION_MONITORING_PACKAGE',
    'OMD_REPUTATION_MONITORING_PACKAGE'
  )),
  CONSTRAINT chk_import_status CHECK (status IN (
    'PENDING','VALIDATED','PREVIEWED','RUNNING','SUCCESS','FAILED','ROLLED_BACK'
  )),
  CONSTRAINT chk_import_purpose CHECK (
    purpose IS NULL OR purpose IN ('DEMO_SEED','INITIAL_IMPORT','UPDATE','AD_HOC','BASELINE','QUARTERLY_IMPORT')
  ),
  CONSTRAINT chk_reporting_period CHECK (
    reporting_start_date IS NULL OR reporting_end_date IS NULL OR reporting_end_date >= reporting_start_date
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE import_batch_items (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  import_batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  external_key VARCHAR(191) NULL,
  entity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  operation VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  message TEXT NULL,
  details_json JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_import_items_batch (import_batch_id),
  KEY idx_import_items_entity (entity_type, external_key),
  KEY idx_import_items_status (import_batch_id, status),
  CONSTRAINT fk_import_items_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_log (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  action VARCHAR(32) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  entity_external_key VARCHAR(191) NULL,
  source VARCHAR(32) NOT NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  import_batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id, created_at),
  KEY idx_audit_external_key (entity_type, entity_external_key, created_at),
  KEY idx_audit_user (user_id, created_at),
  KEY idx_audit_import (import_batch_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_audit_import FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_audit_source CHECK (source IN ('MANUAL','IMPORT','SYSTEM'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
