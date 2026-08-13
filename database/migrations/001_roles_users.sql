-- OMD Valea Jiului migration: Roles and users
-- Generated verbatim from 02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql
-- (sha256 d76b645f05c47707e9edba44cf922dad36b95341ea2b22ea59969c3f402978f4).
-- Do not edit in place: schema changes go into a new numbered migration.

CREATE TABLE roles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  code VARCHAR(32) NOT NULL,
  label VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code),
  CONSTRAINT chk_roles_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  role_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name VARCHAR(191) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME(6) NULL,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role_id),
  KEY idx_users_active (is_active),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT chk_users_active CHECK (is_active IN (0,1)),
  CONSTRAINT chk_users_must_change CHECK (must_change_password IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
