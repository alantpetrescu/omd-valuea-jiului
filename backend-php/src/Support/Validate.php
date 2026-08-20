<?php

/**
 * Input validation — what zod does in the Node backend.
 *
 * Collects every problem before throwing, so a bad payload comes back as one
 * 422 listing all of them rather than one field at a time. The `details` array
 * mirrors zod's issue shape closely enough for the React client, which only
 * ever displays `message`.
 *
 * Deliberately not a general-purpose schema library: it covers the field kinds
 * this API actually accepts, and nothing else.
 *
 *     $v = new Validate($request->body());
 *     $title  = $v->string('title', required: true, max: 500);
 *     $months = $v->intList('seasonalityMonths', min: 1, max: 12);
 *     $v->check();
 */

declare(strict_types=1);

namespace Omd\Support;

use Omd\Http\ApiError;

final class Validate
{
    /** @var list<array{path:string,message:string}> */
    private array $issues = [];

    /** @param array<string,mixed> $input */
    public function __construct(private readonly array $input)
    {
    }

    /** Throws a single 422 carrying every problem found. */
    public function check(string $message = 'Datele nu sunt valide.'): void
    {
        if ($this->issues !== []) {
            throw ApiError::validation($message, $this->issues);
        }
    }

    public function fail(string $path, string $message): void
    {
        $this->issues[] = ['path' => $path, 'message' => $message];
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->input);
    }

    public function raw(string $key): mixed
    {
        return $this->input[$key] ?? null;
    }

    /**
     * A trimmed string.
     *
     * `$required` reports a missing or empty value; otherwise the default is
     * returned, which is `''` — the schema stores NOT NULL text columns and
     * uses the empty string for "not filled in", never NULL.
     */
    public function string(
        string $key,
        bool $required = false,
        int $max = 0,
        string $default = '',
    ): string {
        $value = $this->input[$key] ?? null;

        if ($value === null || $value === '') {
            if ($required) {
                $this->fail($key, 'Câmp obligatoriu.');
            }
            return $default;
        }

        if (!is_scalar($value)) {
            $this->fail($key, 'Trebuie să fie text.');
            return $default;
        }

        $text = trim((string) $value);
        if ($required && $text === '') {
            $this->fail($key, 'Câmp obligatoriu.');
            return $default;
        }
        if ($max > 0 && mb_strlen($text) > $max) {
            $this->fail($key, "Maximum {$max} caractere.");
            return mb_substr($text, 0, $max);
        }

        return $text;
    }

    /** A string that may legitimately be absent — NULL survives as NULL. */
    public function nullableString(string $key, int $max = 0): ?string
    {
        $value = $this->input[$key] ?? null;
        if ($value === null || $value === '') {
            return null;
        }
        return $this->string($key, false, $max);
    }

    public function enum(string $key, array $allowed, ?string $default = null, bool $required = false): ?string
    {
        $value = $this->string($key, false);
        if ($value === '') {
            if ($required) {
                $this->fail($key, 'Câmp obligatoriu.');
            }
            return $default;
        }
        if (!in_array($value, $allowed, true)) {
            $this->fail($key, 'Valoare permisă: ' . implode(', ', $allowed) . '.');
            return $default;
        }
        return $value;
    }

    public function int(string $key, ?int $default = null, ?int $min = null, ?int $max = null): ?int
    {
        $value = $this->input[$key] ?? null;
        if ($value === null || $value === '') {
            return $default;
        }
        if (!is_numeric($value) || (int) $value != $value) {
            $this->fail($key, 'Trebuie să fie un număr întreg.');
            return $default;
        }
        $number = (int) $value;
        if ($min !== null && $number < $min) {
            $this->fail($key, "Minimum {$min}.");
        }
        if ($max !== null && $number > $max) {
            $this->fail($key, "Maximum {$max}.");
        }
        return $number;
    }

    /**
     * A money amount.
     *
     * Returns null for an absent value and keeps it distinct from 0 — an unset
     * budget and a zero budget are different facts throughout this system.
     */
    public function decimal(string $key, ?float $default = null): ?float
    {
        $value = $this->input[$key] ?? null;
        if ($value === null || $value === '') {
            return $default;
        }
        if (!is_numeric($value)) {
            $this->fail($key, 'Trebuie să fie un număr.');
            return $default;
        }
        return (float) $value;
    }

    public function bool(string $key, bool $default = false): bool
    {
        $value = $this->input[$key] ?? null;
        if ($value === null || $value === '') {
            return $default;
        }
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return (int) $value === 1;
        }
        return in_array(strtolower((string) $value), ['true', 'yes', 'da', 'on'], true);
    }

    /** An ISO date, `YYYY-MM-DD`. NULL stays NULL. */
    public function date(string $key): ?string
    {
        $value = $this->string($key, false);
        if ($value === '') {
            return null;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            $this->fail($key, 'Format de dată invalid (aaaa-ll-zz).');
            return null;
        }
        [$year, $month, $day] = array_map('intval', explode('-', $value));
        if (!checkdate($month, $day, $year)) {
            $this->fail($key, 'Data nu există în calendar.');
            return null;
        }
        return $value;
    }

    /**
     * A list of non-empty strings.
     *
     * Blank entries are dropped rather than reported: the UI's list textareas
     * legitimately produce a trailing empty line while the author is typing.
     *
     * @return list<string>
     */
    public function stringList(string $key, int $maxItems = 0, int $maxLength = 0): array
    {
        $value = $this->input[$key] ?? null;
        if ($value === null) {
            return [];
        }
        if (!is_array($value)) {
            $this->fail($key, 'Trebuie să fie o listă.');
            return [];
        }

        $out = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $text = trim((string) $item);
            if ($text === '') {
                continue;
            }
            if ($maxLength > 0 && mb_strlen($text) > $maxLength) {
                $text = mb_substr($text, 0, $maxLength);
            }
            $out[] = $text;
        }

        if ($maxItems > 0 && count($out) > $maxItems) {
            $this->fail($key, "Maximum {$maxItems} elemente.");
            $out = array_slice($out, 0, $maxItems);
        }

        return array_values($out);
    }

    /** @return list<int> */
    public function intList(string $key, ?int $min = null, ?int $max = null): array
    {
        $value = $this->input[$key] ?? null;
        if (!is_array($value)) {
            return [];
        }

        $out = [];
        foreach ($value as $item) {
            if (!is_numeric($item)) {
                continue;
            }
            $number = (int) $item;
            if ($min !== null && $number < $min) {
                continue;
            }
            if ($max !== null && $number > $max) {
                continue;
            }
            $out[] = $number;
        }

        return array_values(array_unique($out));
    }

    /**
     * A list of row objects, each reduced to the named string fields.
     *
     * Rows whose `$requiredField` is blank are dropped, which is what the Node
     * write paths do before inserting — the editors always keep one empty row
     * on screen and it must not reach the database.
     *
     * @param list<string> $fields
     * @return list<array<string,string>>
     */
    public function rows(string $key, array $fields, string $requiredField = ''): array
    {
        $value = $this->input[$key] ?? null;
        if (!is_array($value)) {
            return [];
        }

        $out = [];
        foreach ($value as $item) {
            if (!is_array($item)) {
                continue;
            }
            $row = [];
            foreach ($fields as $field) {
                $cell = $item[$field] ?? '';
                $row[$field] = is_scalar($cell) ? trim((string) $cell) : '';
            }
            if ($requiredField !== '' && ($row[$requiredField] ?? '') === '') {
                continue;
            }
            $out[] = $row;
        }

        return array_values($out);
    }

    /**
     * A nested list kept as-is for a JSON column.
     *
     * @return list<mixed>
     */
    public function jsonList(string $key): array
    {
        $value = $this->input[$key] ?? null;
        return is_array($value) ? array_values($value) : [];
    }
}
