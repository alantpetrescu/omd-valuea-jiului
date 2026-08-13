-- OMD Valea Jiului migration: Strategy versions and strategic reference data
-- Generated verbatim from 02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql
-- (sha256 d76b645f05c47707e9edba44cf922dad36b95341ea2b22ea59969c3f402978f4).
-- Do not edit in place: schema changes go into a new numbered migration.

CREATE TABLE strategy_versions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  external_key VARCHAR(191) NOT NULL,
  label VARCHAR(500) NOT NULL,
  period_start_year SMALLINT UNSIGNED NOT NULL,
  period_end_year SMALLINT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  notes TEXT NULL,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_strategy_versions_external_key (external_key),
  KEY idx_strategy_versions_status (status, period_start_year, period_end_year),
  CONSTRAINT fk_strategy_versions_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_strategy_versions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_strategy_versions_period CHECK (period_end_year >= period_start_year),
  CONSTRAINT chk_strategy_versions_status CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE strategic_pillars (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  strategy_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  code VARCHAR(64) NOT NULL,
  label VARCHAR(500) NOT NULL,
  display_label VARCHAR(255) NOT NULL,
  hint TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_strategic_pillars_version_code (strategy_version_id, code),
  KEY idx_strategic_pillars_active (strategy_version_id, is_active, sort_order),
  CONSTRAINT fk_strategic_pillars_version FOREIGN KEY (strategy_version_id) REFERENCES strategy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_strategic_pillars_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_strategic_pillars_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_strategic_pillars_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE strategic_programs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  strategy_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(500) NOT NULL,
  result_text TEXT NOT NULL,
  marketing_objective TEXT NOT NULL,
  approach TEXT NOT NULL,
  horizon_result_text TEXT NOT NULL,
  target_groups_text TEXT NOT NULL,
  kpi_text TEXT NOT NULL,
  sources_text TEXT NOT NULL,
  annual_actions TEXT NOT NULL,
  validation_status VARCHAR(255) NOT NULL,
  label VARCHAR(750) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_strategic_programs_version_code (strategy_version_id, code),
  KEY idx_strategic_programs_active (strategy_version_id, is_active, sort_order),
  CONSTRAINT fk_strategic_programs_version FOREIGN KEY (strategy_version_id) REFERENCES strategy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_strategic_programs_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_strategic_programs_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_strategic_programs_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE strategic_objectives (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  strategy_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  code VARCHAR(64) NOT NULL,
  name TEXT NOT NULL,
  source VARCHAR(500) NOT NULL,
  label TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_strategic_objectives_version_code (strategy_version_id, code),
  KEY idx_strategic_objectives_active (strategy_version_id, is_active, sort_order),
  CONSTRAINT fk_strategic_objectives_version FOREIGN KEY (strategy_version_id) REFERENCES strategy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_strategic_objectives_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_strategic_objectives_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_strategic_objectives_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE strategic_program_objectives (
  program_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  objective_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (program_id, objective_id),
  KEY idx_spo_objective (objective_id),
  CONSTRAINT fk_spo_program FOREIGN KEY (program_id) REFERENCES strategic_programs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_spo_objective FOREIGN KEY (objective_id) REFERENCES strategic_objectives(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_spo_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
