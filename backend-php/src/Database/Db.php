<?php

/**
 * PDO query helpers — port of `database/db.ts` and `database/pool.ts`.
 *
 * PHP has no connection pool: one request, one connection, closed when the
 * process ends. That removes the pool tuning the Node version needed, but the
 * four correctness settings below still matter and are set explicitly.
 *
 *   ERRMODE_EXCEPTION      a failed statement raises instead of returning false
 *   EMULATE_PREPARES false real prepared statements, as mysql2's `execute()`
 *   time_zone '+00:00'     stored timestamps are UTC
 *   utf8mb4                the schema's charset
 *
 * One difference from mysql2 that callers must know: PDO returns DECIMAL
 * columns as **strings**. The Node pool set `decimalNumbers: true`, so budget
 * figures arrived as numbers and summed. Every projection that reads a DECIMAL
 * therefore passes it through `Db::decimal()`, which yields float|null and
 * keeps NULL distinct from 0.
 */

declare(strict_types=1);

namespace Omd\Database;

use Omd\Config\Env;
use PDO;
use PDOException;
use PDOStatement;

final class Db
{
    private static ?PDO $pdo = null;

    private static int $transactionDepth = 0;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            Env::string('DB_HOST'),
            Env::int('DB_PORT'),
            Env::string('DB_NAME'),
        );

        $pdo = new PDO($dsn, Env::string('DB_USER'), Env::string('DB_PASSWORD'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);

        $pdo->exec("SET time_zone = '+00:00'");

        /*
         * The connection collation, chosen from the server's own banner.
         *
         * `utf8mb4_0900_ai_ci` is UCA 9.0 and exists only in MySQL 8.0+. Asking
         * MariaDB for it fails with `1273 Unknown collation` — at connect, so
         * the application could not even report which server it had found.
         * `Dialect` reads the version off this handle and answers with a
         * collation that exists on it.
         *
         * The catch stays as a net for a build neither branch anticipates: a
         * degraded connection collation is survivable, a refused handshake is
         * not.
         */
        $collation = Dialect::collationFor($pdo);

        try {
            $pdo->exec("SET NAMES utf8mb4 COLLATE {$collation}");
        } catch (PDOException $error) {
            if (!self::isMysqlError($error, self::ERR_UNKNOWN_COLLATION)) {
                throw $error;
            }
            $pdo->exec('SET NAMES utf8mb4');
        }

        self::$pdo = $pdo;
        return $pdo;
    }

    /**
     * Runs a SELECT and returns every row.
     *
     * @param list<mixed>|array<string,mixed> $params
     * @return list<array<string,mixed>>
     */
    public static function rows(string $sql, array $params = []): array
    {
        return array_map([self::class, 'normaliseRow'], self::run($sql, $params)->fetchAll());
    }

    /**
     * Returns the first row, or null when the result set is empty.
     *
     * @param list<mixed>|array<string,mixed> $params
     * @return array<string,mixed>|null
     */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : self::normaliseRow($row);
    }

    /** Returns the first column of the first row. */
    public static function scalar(string $sql, array $params = []): mixed
    {
        $value = self::run($sql, $params)->fetchColumn();
        return $value === false ? null : self::normaliseDateTime($value);
    }

    /**
     * Compensates for a driver difference, at the driver layer where it starts.
     *
     * The timestamp columns are `DATETIME(6)`. mysql2 hands the Node backend
     * `2027-06-20 14:30:00`; PDO hands PHP `2027-06-20 14:30:00.000000`. Same
     * instant, seven characters apart — and enough to make two otherwise
     * identical API responses differ, which was how it was found.
     *
     * Trimming here rather than in each projection is deliberate: there are a
     * dozen timestamp aliases across four modules plus two aggregates, and a
     * per-site fix is a fix you forget on the thirteenth.
     *
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private static function normaliseRow(array $row): array
    {
        foreach ($row as $key => $value) {
            if (is_string($value)) {
                $row[$key] = self::normaliseDateTime($value);
            }
        }
        return $row;
    }

    private static function normaliseDateTime(mixed $value): mixed
    {
        if (!is_string($value)) {
            return $value;
        }

        /*
         * Only an all-zero fraction is dropped, and that is not a stylistic
         * choice — it is what mysql2 does, established by comparing the two
         * backends field by field:
         *
         *   observed_at  .000000  ->  mysql2 gives 14:30:00       PDO gives .000000
         *   created_at   .411812  ->  mysql2 gives .411812        PDO gives .411812
         *
         * Trimming every fraction, which is what this first did, made the users
         * endpoint disagree in the opposite direction — it threw away precision
         * the Node backend reports. A rule derived from one example is a rule
         * that breaks on the second.
         */
        return (string) preg_replace(
            '/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.0+$/',
            '$1',
            $value,
        );
    }

    public static function count(string $sql, array $params = []): int
    {
        return (int) (self::scalar($sql, $params) ?? 0);
    }

    /**
     * Runs INSERT/UPDATE/DELETE and returns the affected row count.
     *
     * @param list<mixed>|array<string,mixed> $params
     */
    public static function execute(string $sql, array $params = []): int
    {
        return self::run($sql, $params)->rowCount();
    }

    /**
     * Runs `$fn` inside a transaction, committing on success and rolling back
     * on any thrown error.
     *
     * Nesting is counted rather than attempted: MySQL has no nested
     * transactions, and a repository called from inside another transaction
     * must join it, not open a second one.
     *
     * @template T
     * @param callable():T $fn
     * @return T
     */
    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();

        if (self::$transactionDepth > 0) {
            self::$transactionDepth++;
            try {
                return $fn();
            } finally {
                self::$transactionDepth--;
            }
        }

        $pdo->beginTransaction();
        self::$transactionDepth = 1;
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (\Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        } finally {
            self::$transactionDepth = 0;
        }
    }

    /**
     * Builds `?, ?, ?` for an `IN (...)` clause.
     *
     * Returns `NULL` for an empty list so `IN (NULL)` matches nothing rather
     * than producing a syntax error.
     *
     * @param list<mixed> $values
     */
    public static function placeholders(array $values): string
    {
        return $values === [] ? 'NULL' : implode(', ', array_fill(0, count($values), '?'));
    }

    /**
     * Builds `LIMIT n OFFSET m`.
     *
     * MySQL's prepared-statement protocol rejects placeholders in LIMIT and
     * OFFSET, so the values are inlined — but only after being forced to
     * non-negative integers here. This is the one sanctioned place where a
     * value enters SQL as a literal.
     */
    public static function limit(int $limit, int $offset): string
    {
        return sprintf('LIMIT %d OFFSET %d', max(0, $limit), max(0, $offset));
    }

    /**
     * Dash characters people type interchangeably.
     *
     * Editorial text arrives full of en and em dashes while people search with
     * the hyphen on their keyboard. The collation folds case and diacritics;
     * dashes it does not.
     *
     * @var list<string>
     */
    private const DASH_VARIANTS = ['–', '—', '‑', '−'];

    public static function normalizeDashes(string $value): string
    {
        return str_replace(self::DASH_VARIANTS, '-', $value);
    }

    /** Wraps a column so it compares dash-insensitively. */
    public static function dashInsensitive(string $column): string
    {
        $expression = $column;
        foreach (self::DASH_VARIANTS as $dash) {
            $expression = sprintf("REPLACE(%s, '%s', '-')", $expression, $dash);
        }
        return $expression;
    }

    /**
     * A DECIMAL column as a number, preserving NULL.
     *
     * NULL must never collapse to 0: an unset budget and a zero budget are
     * different facts, and the whole reporting layer depends on the difference.
     */
    public static function decimal(mixed $value): ?float
    {
        return $value === null || $value === '' ? null : (float) $value;
    }

    /** An INT column as int|null, preserving NULL for the same reason. */
    public static function int(mixed $value): ?int
    {
        return $value === null || $value === '' ? null : (int) $value;
    }

    /** A JSON column decoded to an array; `[]` when NULL or unreadable. */
    public static function json(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || $value === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    /** True when the exception is the given MySQL error, e.g. `1062` duplicate. */
    public static function isMysqlError(PDOException $error, int $code): bool
    {
        return isset($error->errorInfo[1]) && (int) $error->errorInfo[1] === $code;
    }

    public const ERR_DUPLICATE_ENTRY = 1062;
    public const ERR_NO_REFERENCED_ROW = 1452;
    public const ERR_ROW_IS_REFERENCED = 1451;
    public const ERR_CHECK_CONSTRAINT = 3819;
    /** MySQL 8 collations do not exist on MariaDB or MySQL 5.7. */
    public const ERR_UNKNOWN_COLLATION = 1273;

    /** @param list<mixed>|array<string,mixed> $params */
    private static function run(string $sql, array $params): PDOStatement
    {
        $statement = self::pdo()->prepare($sql);
        // Bind explicitly: with emulation off, PDO would otherwise send every
        // parameter as a string, and MySQL 8 refuses a string where a LIMIT-like
        // integer context is expected.
        foreach ($params as $key => $value) {
            $name = is_int($key) ? $key + 1 : $key;
            $statement->bindValue($name, $value, self::pdoType($value));
        }
        $statement->execute();
        return $statement;
    }

    private static function pdoType(mixed $value): int
    {
        return match (true) {
            $value === null => PDO::PARAM_NULL,
            is_bool($value) => PDO::PARAM_INT,
            is_int($value) => PDO::PARAM_INT,
            default => PDO::PARAM_STR,
        };
    }

    /** Cheap liveness probe for GET /api/v1/health/ready. */
    public static function ping(): void
    {
        self::pdo()->query('SELECT 1');
    }
}
