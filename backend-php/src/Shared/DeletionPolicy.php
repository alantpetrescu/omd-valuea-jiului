<?php

/**
 * Deletion & referential integrity — port of `shared/deletion-policy.ts`.
 *
 * The rule that shapes all of it: an entity with history is never deleted.
 * Finishing work is expressed with the CLOSED status, not by removing the row.
 * Only an accidental, unused DRAFT may be soft-deleted.
 *
 * Dependency counts include CLOSED, inactive and soft-deleted rows — anything
 * that physically still holds a reference. Counting only what the UI currently
 * lists would let a delete quietly break history.
 */

declare(strict_types=1);

namespace Omd\Shared;

use Omd\Audit\Audit;
use Omd\Database\Db;
use Omd\Http\ApiError;

final class DeletionPolicy
{
    /** @return array<string,mixed> */
    public static function assessCampaign(string $campaignId): array
    {
        $checks = [
            ['ACTIVATION', 'SELECT COUNT(*) FROM activations WHERE campaign_id = ?'],
            ['ANNUAL_PLAN', 'SELECT COUNT(*) FROM annual_plan_campaigns WHERE campaign_id = ?'],
            ['CHILD_CAMPAIGN', 'SELECT COUNT(*) FROM campaigns WHERE parent_campaign_id = ?'],
            ['SUCCESSOR_CAMPAIGN', 'SELECT COUNT(*) FROM campaigns WHERE supersedes_campaign_id = ?'],
            ['TEMPLATE_USED_BY_MATERIAL',
                'SELECT COUNT(*) FROM activation_materials WHERE template_campaign_id = ?'],
        ];

        return self::assess($checks, $campaignId,
            'Campania nu poate fi ștearsă deoarece are istoric în sistem. '
            . 'Dacă activitatea s-a încheiat, schimbă stadiul în „Încheiată”.');
    }

    /** @return array<string,mixed> */
    public static function assessActivation(string $activationId): array
    {
        $checks = [
            ['ANNUAL_PLAN', 'SELECT COUNT(*) FROM annual_plan_activations WHERE activation_id = ?'],
            ['PERFORMANCE_SNAPSHOT',
                'SELECT COUNT(*) FROM material_performance_snapshots WHERE activation_id = ?'],
        ];

        return self::assess($checks, $activationId,
            'Activarea nu poate fi ștearsă deoarece are istoric în sistem. '
            . 'Dacă s-a încheiat, schimbă stadiul în „Încheiată”.');
    }

    /**
     * @param list<array{0:string,1:string}> $checks
     * @return array<string,mixed>
     */
    private static function assess(array $checks, string $id, string $reason): array
    {
        $dependencies = [];
        foreach ($checks as [$type, $sql]) {
            $total = Db::count($sql, [$id]);
            if ($total > 0) {
                $dependencies[] = ['type' => $type, 'count' => $total];
            }
        }

        $blocked = $dependencies !== [];
        return [
            'canDelete' => !$blocked,
            'canClose' => true,
            'dependencies' => $dependencies,
            'reason' => $blocked ? $reason : null,
        ];
    }

    /**
     * Soft-deletes a campaign after re-running the dependency check.
     *
     * The re-check is required, not defensive style: the preview the user saw
     * may be seconds old and an activation could have been created meanwhile.
     */
    public static function softDeleteCampaign(string $externalKey, ?string $userId): void
    {
        Db::transaction(static function () use ($externalKey, $userId): void {
            $campaign = Db::one(
                'SELECT id, title FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
                [$externalKey],
            );
            if ($campaign === null) {
                throw ApiError::notFound('Campania nu a fost găsită.');
            }

            $assessment = self::assessCampaign((string) $campaign['id']);
            if ($assessment['canDelete'] !== true) {
                throw new ApiError('ENTITY_IN_USE', (string) $assessment['reason'], [
                    'entityType' => 'CAMPAIGN',
                    'externalKey' => $externalKey,
                    'dependencies' => $assessment['dependencies'],
                    'allowedAction' => 'CLOSE',
                ]);
            }

            Db::execute(
                'UPDATE campaigns SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ? WHERE id = ?',
                [$userId, $campaign['id']],
            );

            Audit::write(
                userId: $userId,
                action: 'SOFT_DELETE',
                entityType: 'CAMPAIGN',
                entityId: (string) $campaign['id'],
                entityExternalKey: $externalKey,
                oldValues: ['title' => $campaign['title']],
            );
        });
    }

    public static function softDeleteActivation(string $externalKey, ?string $userId): void
    {
        Db::transaction(static function () use ($externalKey, $userId): void {
            $activation = Db::one(
                'SELECT id, title FROM activations WHERE external_key = ? AND deleted_at IS NULL',
                [$externalKey],
            );
            if ($activation === null) {
                throw ApiError::notFound('Activarea nu a fost găsită.');
            }

            $assessment = self::assessActivation((string) $activation['id']);
            if ($assessment['canDelete'] !== true) {
                throw new ApiError('ENTITY_IN_USE', (string) $assessment['reason'], [
                    'entityType' => 'ACTIVATION',
                    'externalKey' => $externalKey,
                    'dependencies' => $assessment['dependencies'],
                    'allowedAction' => 'CLOSE',
                ]);
            }

            // Owned children without history go with the parent, in the same
            // transaction — they have no meaning on their own.
            Db::execute(
                'UPDATE activation_materials SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ?
                  WHERE activation_id = ?',
                [$userId, $activation['id']],
            );
            Db::execute(
                'UPDATE activation_kpis SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ?
                  WHERE activation_id = ?',
                [$userId, $activation['id']],
            );
            Db::execute(
                'UPDATE activations SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ? WHERE id = ?',
                [$userId, $activation['id']],
            );

            Audit::write(
                userId: $userId,
                action: 'SOFT_DELETE',
                entityType: 'ACTIVATION',
                entityId: (string) $activation['id'],
                entityExternalKey: $externalKey,
                oldValues: ['title' => $activation['title']],
            );
        });
    }

    /** Restores a soft-deleted entity. ADMIN only at the route level. */
    public static function restore(string $table, string $externalKey, ?string $userId): void
    {
        if (!in_array($table, ['campaigns', 'activations'], true)) {
            throw ApiError::badRequest('Entitate necunoscută.');
        }

        $row = Db::one(
            "SELECT id FROM {$table} WHERE external_key = ? AND deleted_at IS NOT NULL",
            [$externalKey],
        );
        if ($row === null) {
            throw ApiError::notFound('Nu există o înregistrare ștearsă cu această cheie.');
        }

        Db::execute("UPDATE {$table} SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", [$row['id']]);

        Audit::write(
            userId: $userId,
            action: 'RESTORE',
            entityType: $table === 'campaigns' ? 'CAMPAIGN' : 'ACTIVATION',
            entityId: (string) $row['id'],
            entityExternalKey: $externalKey,
        );
    }
}
