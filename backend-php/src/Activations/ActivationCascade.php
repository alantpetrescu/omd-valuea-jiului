<?php

/**
 * What happens to a campaign's activations when the campaign's own stage moves.
 *
 * An activation is the concrete execution of a campaign. Leaving one `Activă`
 * under a campaign that has gone back to `Draft` says two contradictory things
 * about the same work, and the operational screens believe both: the calendar
 * draws the activation as running while the campaign fiche says it is not
 * approved yet.
 *
 * ### The rule
 *
 * | campania devine | activările afectate | devin |
 * |---|---|---|
 * | `DRAFT`  | cele `ACTIVE`            | `DRAFT`  |
 * | `CLOSED` | cele `ACTIVE`            | `CLOSED` |
 * | `ACTIVE` | cele `DRAFT` sau `CLOSED`, **a căror perioadă nu s-a încheiat** | `ACTIVE` |
 *
 * The third row is the one that needs the date. Re-activating a campaign cannot
 * revive an activation whose period is over — a week in March does not start
 * running again because someone reopened the campaign in August. So only the
 * ones still ahead or still under way come back.
 *
 * An activation that is `DRAFT` **and** already finished is left exactly as it
 * is. "Becomes active where applicable" is the rule; not applicable means
 * unchanged, not "pick another status for it".
 *
 * ### What this is not
 *
 * It is not the `Situația în calendar` from spec §27. That one is computed at
 * display time from status plus dates and is never stored. This writes
 * `status_id`, which is a decision a person made about a campaign, propagated to
 * the records that hang off it — and, like any stored decision, it is a snapshot
 * of the moment it was taken.
 */

declare(strict_types=1);

namespace Omd\Activations;

use Omd\Audit\Audit;
use Omd\Database\Db;

final class ActivationCascade
{
    /**
     * Applies the campaign's new stage to its activations.
     *
     * Call inside the campaign's own transaction: either both move or neither
     * does. Returns the number of activations changed, for the caller's audit
     * trail and for tests.
     */
    public static function applyCampaignStatus(
        string $campaignId,
        string $previousStatusCode,
        string $newStatusCode,
        ?string $userId,
    ): int {
        if ($previousStatusCode === $newStatusCode) {
            return 0;
        }

        [$from, $dateGuard] = match ($newStatusCode) {
            'DRAFT', 'CLOSED' => [['ACTIVE'], ''],
            // Only activations that have not finished. A null end date is an
            // open-ended activation, not a finished one.
            'ACTIVE' => [['DRAFT', 'CLOSED'], ' AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE())'],
            default => [[], ''],
        };

        if ($from === []) {
            return 0;
        }

        $targetId = Db::scalar('SELECT id FROM campaign_statuses WHERE code = ?', [$newStatusCode]);
        if (!is_string($targetId)) {
            return 0;
        }

        $placeholders = Db::placeholders($from);
        $affected = Db::rows(
            "SELECT a.id, a.external_key, a.title, st.code AS statusCode
               FROM activations a
               JOIN campaign_statuses st ON st.id = a.status_id
              WHERE a.campaign_id = ?
                AND a.deleted_at IS NULL
                AND st.code IN ({$placeholders}){$dateGuard}",
            array_merge([$campaignId], $from),
        );

        foreach ($affected as $activation) {
            /*
             * `version_number` is bumped deliberately.
             *
             * Someone with this activation open in an editor now gets
             * `409 STALE_VERSION` on save — which is the correct answer, because
             * the record really did change underneath them. Leaving the version
             * alone would let their form overwrite the cascade without either
             * side noticing.
             */
            Db::execute(
                'UPDATE activations
                    SET status_id = ?, version_number = version_number + 1, updated_by = ?
                  WHERE id = ?',
                [$targetId, $userId, $activation['id']],
            );

            Audit::write(
                userId: $userId,
                action: 'UPDATE',
                entityType: 'ACTIVATION',
                entityId: (string) $activation['id'],
                entityExternalKey: (string) $activation['external_key'],
                oldValues: ['status' => $activation['statusCode']],
                // The reason travels with the row. Without it the trail shows a
                // status change nobody made, and the person reading it a month
                // later has to guess.
                newValues: [
                    'status' => $newStatusCode,
                    'cauza' => 'stadiul campaniei a devenit ' . $newStatusCode,
                ],
            );
        }

        return count($affected);
    }
}
