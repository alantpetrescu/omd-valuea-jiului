<?php

/**
 * Asset storage — port of `assets/storage.ts`.
 *
 * Business code never touches the filesystem directly and never sees an
 * absolute path. `assets.storage_path` is an opaque key, so replacing this
 * local implementation with S3 later is a new class rather than a rewrite of
 * the campaign and activation services.
 */

declare(strict_types=1);

namespace Omd\Assets;

use Omd\Config\Env;
use Omd\Support\Ids;
use RuntimeException;

final class Storage
{
    private const MIME_EXTENSIONS = [
        'image/jpeg' => '.jpg',
        'image/png' => '.png',
        'image/webp' => '.webp',
        'image/gif' => '.gif',
        'image/svg+xml' => '.svg',
    ];

    public static function isAllowedImageMime(string $mime): bool
    {
        return array_key_exists(strtolower($mime), self::MIME_EXTENSIONS);
    }

    public static function extensionForMime(string $mime): string
    {
        return self::MIME_EXTENSIONS[strtolower($mime)] ?? '.bin';
    }

    /**
     * Builds a storage key.
     *
     * The server names the file; a user-supplied filename is never used, which
     * removes path traversal as a category rather than filtering for it.
     */
    public static function buildStorageKey(string $mimeType): string
    {
        return gmdate('Y') . '/' . gmdate('m') . '/' . Ids::newId() . self::extensionForMime($mimeType);
    }

    /**
     * The storage root, in the same normalised form `resolve()` compares against.
     *
     * Normalising here is what makes the guard below work at all. `UPLOAD_DIR`
     * can carry native separators — on Windows it resolves to
     * `D:\…\omd-valea-jiului/storage/uploads`, mixed — while `resolve()`
     * compares a fully forward-slashed target. Comparing the two forms made
     * every key look like an escape attempt, so publishing an asset failed on
     * Windows and only there. The traversal guard itself is unchanged.
     */
    private static function root(): string
    {
        return rtrim(str_replace('\\', '/', Env::path('UPLOAD_DIR')), '/');
    }

    /**
     * Mode for the `YYYY/MM` directories created under `UPLOAD_DIR`.
     *
     * `0755`, not `0770`. These sit inside the document root and Apache serves
     * the files in them straight off disk — which it can only do if it may
     * traverse into them. Under 0770 the images were written correctly, owned by
     * the right user, readable at 0644, and completely unreachable: the
     * directory denied entry, so the request came back 404 while File Manager
     * showed the file sitting there. Hours were spent looking for a missing
     * file that was never missing.
     *
     * The staging and rate-limit directories stay 0770 on purpose — nothing
     * serves those over HTTP, and they should not be world-traversable.
     */
    private const DIRECTORY_MODE = 0755;

    /** Resolves a key inside the root and refuses anything that escapes it. */
    private static function resolve(string $storageKey): string
    {
        $root = self::root();
        $target = $root . '/' . ltrim(str_replace('\\', '/', $storageKey), '/');

        // Compare the normalised forms: realpath() would return false for a file
        // that does not exist yet, which is exactly the publish case.
        $normalised = self::normalise($target);
        if ($normalised !== $root && !str_starts_with($normalised, $root . '/')) {
            throw new RuntimeException("Storage key escapes the storage root: {$storageKey}");
        }
        return $normalised;
    }

    private static function normalise(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        $parts = [];
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.') {
                if ($parts === [] && $segment === '') {
                    $parts[] = '';
                }
                continue;
            }
            if ($segment === '..') {
                array_pop($parts);
                continue;
            }
            $parts[] = $segment;
        }
        return implode('/', $parts);
    }

    public static function exists(string $storageKey): bool
    {
        return is_file(self::resolve($storageKey));
    }

    public static function read(string $storageKey): string
    {
        $contents = @file_get_contents(self::resolve($storageKey));
        if ($contents === false) {
            throw new RuntimeException("Asset not readable: {$storageKey}");
        }
        return $contents;
    }

    public static function write(string $storageKey, string $bytes): void
    {
        $target = self::resolve($storageKey);
        $directory = dirname($target);
        if (!is_dir($directory) && !@mkdir($directory, self::DIRECTORY_MODE, true) && !is_dir($directory)) {
            throw new RuntimeException("Cannot create storage directory: {$directory}");
        }
        if (@file_put_contents($target, $bytes) === false) {
            throw new RuntimeException("Cannot write asset: {$storageKey}");
        }
    }

    /** Moves an already-staged temporary file into permanent storage. */
    public static function publish(string $temporaryPath, string $storageKey): void
    {
        $target = self::resolve($storageKey);
        $directory = dirname($target);
        if (!is_dir($directory) && !@mkdir($directory, self::DIRECTORY_MODE, true) && !is_dir($directory)) {
            throw new RuntimeException("Cannot create storage directory: {$directory}");
        }
        if (!@rename($temporaryPath, $target)) {
            // rename fails across filesystems; fall back to copy + unlink.
            if (!@copy($temporaryPath, $target)) {
                throw new RuntimeException("Cannot publish asset: {$storageKey}");
            }
            @unlink($temporaryPath);
        }
    }

    public static function delete(string $storageKey): void
    {
        @unlink(self::resolve($storageKey));
    }

    /** The URL the frontend loads. Never the storage key itself. */
    public static function publicUrl(string $storageKey): string
    {
        return '/uploads/' . ltrim(str_replace('\\', '/', $storageKey), '/');
    }

    /**
     * Serves a file under `/uploads/`, the counterpart of Express's
     * `app.use('/uploads', express.static(...))`.
     *
     * In production nginx or Apache maps `/uploads/` straight to disk and this
     * never runs — but "the web server will handle it" is not true everywhere.
     * On a shared host the rewrite sends every path here, and under the PHP
     * built-in server there is no other handler at all, so without this the
     * images an import just published resolve to 404. An importer that writes
     * files nothing can display is only half a feature.
     *
     * Matches the Express options it replaces: a missing file is a 404 rather
     * than a fall-through, and the one-hour cache window is the same.
     *
     * @return bool false when the path is not an upload, so the caller
     *              continues to the router
     */
    public static function serve(string $path): bool
    {
        if (!str_starts_with($path, '/uploads/')) {
            return false;
        }

        $key = substr($path, strlen('/uploads/'));

        // resolve() rejects traversal; a rejected key is a 404, never a 500,
        // because a probe should learn nothing from the difference.
        try {
            $file = self::resolve($key);
        } catch (RuntimeException) {
            $file = null;
        }

        if ($file === null || !is_file($file)) {
            http_response_code(404);
            header('Content-Type: application/json; charset=utf-8');
            echo (string) json_encode(['error' => ['code' => 'NOT_FOUND', 'message' => 'Fișier inexistent.']]);
            return true;
        }

        $extension = strtolower((string) strrchr($file, '.'));
        $mime = array_search($extension, self::MIME_EXTENSIONS, true);

        http_response_code(200);
        header('Content-Type: ' . ($mime === false ? 'application/octet-stream' : $mime));
        header('Content-Length: ' . (string) filesize($file));
        header('Cache-Control: public, max-age=3600');
        // The bytes are images the application itself named and wrote, but a
        // sniffed content type is still a way to get a file interpreted as
        // something it is not.
        header('X-Content-Type-Options: nosniff');
        readfile($file);

        return true;
    }

    /**
     * Decodes a `data:image/…;base64,…` URI into the import temp directory.
     *
     * Base64 is never persisted in MySQL. The caller publishes the staged file
     * inside the import transaction and removes it on rollback.
     *
     * @return array{temporaryPath:string,storageKey:string,filename:string,mimeType:string,fileSize:int,checksumSha256:string}
     */
    public static function stageDataUri(string $dataUri): array
    {
        if (preg_match('/^data:([^;,]+);base64,(.*)$/s', trim($dataUri), $match) !== 1) {
            throw new RuntimeException('Expected a data:<mime>;base64,<payload> URI.');
        }

        $mimeType = strtolower($match[1]);
        if (!self::isAllowedImageMime($mimeType)) {
            throw new RuntimeException("MIME type not allowed for application images: {$mimeType}");
        }

        $bytes = base64_decode($match[2], true);
        if ($bytes === false || $bytes === '') {
            throw new RuntimeException('Decoded asset is empty.');
        }

        $maxBytes = Env::int('MAX_UPLOAD_MB') * 1024 * 1024;
        if (strlen($bytes) > $maxBytes) {
            throw new RuntimeException(sprintf(
                'Decoded asset is %d bytes, over the %d MB limit.',
                strlen($bytes),
                Env::int('MAX_UPLOAD_MB'),
            ));
        }

        $storageKey = self::buildStorageKey($mimeType);
        $tempDir = Env::path('IMPORT_TEMP_DIR');
        if (!is_dir($tempDir) && !@mkdir($tempDir, 0770, true) && !is_dir($tempDir)) {
            throw new RuntimeException("Cannot create import temp directory: {$tempDir}");
        }

        $temporaryPath = $tempDir . '/' . Ids::newId() . '.part';
        if (@file_put_contents($temporaryPath, $bytes) === false) {
            throw new RuntimeException('Cannot stage the decoded asset.');
        }

        return [
            'temporaryPath' => $temporaryPath,
            'storageKey' => $storageKey,
            'filename' => basename($storageKey),
            'mimeType' => $mimeType,
            'fileSize' => strlen($bytes),
            'checksumSha256' => hash('sha256', $bytes),
        ];
    }

    /** A `data:` URI for an asset already in storage — used by the exporter. */
    public static function toDataUri(string $storageKey, string $mimeType): ?string
    {
        if (!self::exists($storageKey)) {
            return null;
        }
        return 'data:' . $mimeType . ';base64,' . base64_encode(self::read($storageKey));
    }
}
