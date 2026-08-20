<?php

/**
 * A JSON Schema validator, covering exactly what the four frozen contracts use.
 *
 * The Node backend runs Ajv. There is no Composer here, so this implements the
 * keyword set the contracts actually contain — counted from the schema files
 * rather than guessed:
 *
 *   type  $ref  items  additionalProperties  required  properties  minimum
 *   maximum  minLength  format  const  enum  pattern  uniqueItems  anyOf
 *
 * `$ref` is always local (`#/$defs/name`) in these contracts, so no remote
 * resolution exists — and adding it would be a way for a schema file to make
 * the validator fetch a URL, which is not a capability worth having.
 *
 * Errors read like Ajv's — `/campaigns/0/title must NOT have fewer than 1
 * characters` — because both backends surface them to the same import screen
 * and they are compared during a migration.
 *
 * Validation runs on the *decoded JSON tree*: `stdClass` for objects, PHP list
 * for arrays. `Contract::validate()` normalises by encoding and decoding, which
 * removes the ambiguity of PHP's empty array being both `[]` and `{}`.
 */

declare(strict_types=1);

namespace Omd\Imports;

final class JsonSchema
{
    /** @var array<string,mixed> */
    private array $defs = [];

    /** @var list<string> */
    private array $errors = [];

    public function __construct(private readonly object $schema)
    {
        $defs = $schema->{'$defs'} ?? null;
        if (is_object($defs)) {
            $this->defs = (array) $defs;
        }
    }

    /**
     * @return list<string> empty when the document satisfies the schema
     */
    public function validate(mixed $document): array
    {
        $this->errors = [];
        $this->check($document, $this->schema, '');
        return $this->errors;
    }

    private function fail(string $path, string $message): void
    {
        $this->errors[] = trim(($path === '' ? '(root)' : $path) . ' ' . $message);
    }

    private function resolve(object $schema): object
    {
        $ref = $schema->{'$ref'} ?? null;
        if (!is_string($ref)) {
            return $schema;
        }
        if (!str_starts_with($ref, '#/$defs/')) {
            // A non-local reference is a schema authoring error, not a document
            // error — reported rather than silently skipped.
            $this->fail('', "unsupported \$ref: {$ref}");
            return (object) [];
        }
        $name = substr($ref, strlen('#/$defs/'));
        $target = $this->defs[$name] ?? null;
        if (!is_object($target)) {
            $this->fail('', "unknown \$ref: {$ref}");
            return (object) [];
        }
        return $target;
    }

    private function check(mixed $value, object $schema, string $path): void
    {
        $schema = $this->resolve($schema);

        if (isset($schema->anyOf) && is_array($schema->anyOf)) {
            foreach ($schema->anyOf as $branch) {
                if (!is_object($branch)) {
                    continue;
                }
                $probe = new self($this->schema);
                $probe->defs = $this->defs;
                $probe->errors = [];
                $probe->check($value, $branch, $path);
                if ($probe->errors === []) {
                    return;
                }
            }
            $this->fail($path, 'must match a schema in anyOf');
            return;
        }

        if (isset($schema->const)) {
            if ($value !== $schema->const) {
                $this->fail($path, 'must be equal to constant');
            }
            return;
        }

        if (isset($schema->enum) && is_array($schema->enum)) {
            if (!in_array($value, $schema->enum, true)) {
                $this->fail($path, 'must be equal to one of the allowed values');
            }
            return;
        }

        $type = $schema->type ?? null;
        if (is_string($type) && !$this->checkType($value, $type, $path)) {
            return;
        }

        if (is_object($value)) {
            $this->checkObject($value, $schema, $path);
            return;
        }

        if (is_array($value)) {
            $this->checkArray($value, $schema, $path);
            return;
        }

        if (is_string($value)) {
            $this->checkString($value, $schema, $path);
            return;
        }

        if (is_int($value) || is_float($value)) {
            $this->checkNumber($value, $schema, $path);
        }
    }

    private function checkType(mixed $value, string $type, string $path): bool
    {
        $ok = match ($type) {
            'object' => is_object($value),
            'array' => is_array($value),
            'string' => is_string($value),
            'integer' => is_int($value) || (is_float($value) && floor($value) === $value),
            'number' => is_int($value) || is_float($value),
            'boolean' => is_bool($value),
            'null' => $value === null,
            default => true,
        };

        if (!$ok) {
            $this->fail($path, "must be {$type}");
        }
        return $ok;
    }

    private function checkObject(object $value, object $schema, string $path): void
    {
        $properties = isset($schema->properties) && is_object($schema->properties)
            ? (array) $schema->properties
            : [];

        foreach ($schema->required ?? [] as $name) {
            if (!property_exists($value, (string) $name)) {
                $this->fail($path, "must have required property '{$name}'");
            }
        }

        foreach ((array) $value as $name => $item) {
            $child = $path . '/' . $name;
            if (isset($properties[$name]) && is_object($properties[$name])) {
                $this->check($item, $properties[$name], $child);
                continue;
            }
            if (($schema->additionalProperties ?? true) === false) {
                $this->fail($path, "must NOT have additional properties: {$name}");
            }
        }
    }

    /** @param list<mixed> $value */
    private function checkArray(array $value, object $schema, string $path): void
    {
        if (isset($schema->minItems) && count($value) < $schema->minItems) {
            $this->fail($path, "must NOT have fewer than {$schema->minItems} items");
        }
        if (isset($schema->maxItems) && count($value) > $schema->maxItems) {
            $this->fail($path, "must NOT have more than {$schema->maxItems} items");
        }
        if (($schema->uniqueItems ?? false) === true) {
            $seen = [];
            foreach ($value as $item) {
                $key = json_encode($item);
                if (isset($seen[$key])) {
                    $this->fail($path, 'must NOT have duplicate items');
                    break;
                }
                $seen[$key] = true;
            }
        }
        if (isset($schema->items) && is_object($schema->items)) {
            foreach ($value as $index => $item) {
                $this->check($item, $schema->items, $path . '/' . $index);
            }
        }
    }

    private function checkString(string $value, object $schema, string $path): void
    {
        if (isset($schema->minLength) && mb_strlen($value) < $schema->minLength) {
            $this->fail($path, "must NOT have fewer than {$schema->minLength} characters");
        }
        if (isset($schema->maxLength) && mb_strlen($value) > $schema->maxLength) {
            $this->fail($path, "must NOT have more than {$schema->maxLength} characters");
        }
        if (isset($schema->pattern) && @preg_match('/' . str_replace('/', '\/', $schema->pattern) . '/u', $value) !== 1) {
            $this->fail($path, "must match pattern \"{$schema->pattern}\"");
        }
        if (isset($schema->format) && !self::matchesFormat($value, (string) $schema->format)) {
            $this->fail($path, "must match format \"{$schema->format}\"");
        }
    }

    private function checkNumber(int|float $value, object $schema, string $path): void
    {
        if (isset($schema->minimum) && $value < $schema->minimum) {
            $this->fail($path, "must be >= {$schema->minimum}");
        }
        if (isset($schema->maximum) && $value > $schema->maximum) {
            $this->fail($path, "must be <= {$schema->maximum}");
        }
    }

    /**
     * The two formats the contracts use, matching ajv-formats.
     *
     * `date` is a real calendar check, not just a shape: 2026-02-30 has the
     * right digits and does not exist.
     */
    private static function matchesFormat(string $value, string $format): bool
    {
        return match ($format) {
            'date' => preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1
                && checkdate((int) $m[2], (int) $m[3], (int) $m[1]),
            'date-time' => preg_match(
                '/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/',
                $value,
            ) === 1,
            'uri' => preg_match('/^[a-zA-Z][a-zA-Z0-9+.-]*:/', $value) === 1,
            'email' => filter_var($value, FILTER_VALIDATE_EMAIL) !== false,
            default => true,
        };
    }
}
