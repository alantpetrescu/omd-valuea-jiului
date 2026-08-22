<?php

/**
 * Campaign create and update — port of `campaigns/campaign-write.ts`.
 *
 * Rules enforced here:
 *   - the server generates `id` and `external_key`; the client never does;
 *   - `external_key` is immutable — editing never regenerates it;
 *   - a manually created campaign belongs to the ACTIVE strategy version;
 *   - programs, objectives and pillars resolve WITHIN that strategy version;
 *   - the row and all four relation sets move together, in one transaction;
 *   - update is guarded by `version_number`, returning 409 STALE_VERSION rather
 *     than silently overwriting a concurrent edit.
 */

declare(strict_types=1);

namespace Omd\Campaigns;

use Omd\Activations\ActivationCascade;
use Omd\Audit\Audit;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Support\Ids;
use Omd\Support\Validate;

final class CampaignWrite
{
    /**
     * The wizard's input contract.
     *
     * Required fields mirror the prototype's per-step validation, so the API
     * cannot be used to create a campaign the UI would have refused.
     *
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function parseInput(array $body): array
    {
        $v = new Validate($body);

        $input = [
            // Step 1 — Identificare
            'title' => $v->string('title', required: true, max: 500),
            'campaignTypeCode' => $v->string('campaignTypeCode', required: true),
            'pillarCode' => $v->string('pillarCode', required: true),
            'seasonalityTypeCode' => $v->string('seasonalityTypeCode', required: true),
            'seasonalityMonths' => $v->intList('seasonalityMonths', min: 1, max: 12),
            'seasonalityNote' => $v->string('seasonalityNote'),
            'statusCode' => $v->string('statusCode') ?: 'DRAFT',
            'responsible' => $v->string('responsible', max: 255),
            'accent' => $v->string('accent') ?: 'umbrella',
            'version' => $v->string('version', max: 255),
            'parentCampaignExternalKey' => $v->nullableString('parentCampaignExternalKey'),
            'campaignFamilyExternalKey' => $v->nullableString('campaignFamilyExternalKey'),

            // Step 2 — Încadrare strategică
            'programPrimaryCode' => $v->string('programPrimaryCode', required: true),
            'programSecondaryCodes' => $v->stringList('programSecondaryCodes'),
            'objectivePrimaryCode' => $v->string('objectivePrimaryCode', required: true),
            'objectiveSecondaryCodes' => $v->stringList('objectiveSecondaryCodes'),
            'marketingObjective' => $v->string('marketingObjective', required: true),
            'directResult' => $v->string('directResult', required: true),
            'strategicContribution' => $v->stringList('strategicContribution'),

            // Step 3 — Publicuri
            'primaryAudienceCode' => $v->string('primaryAudienceCode', required: true),
            'secondaryAudienceCodes' => $v->stringList('secondaryAudienceCodes'),
            'primaryAudienceDescription' => $v->string('primaryAudienceDescription'),
            'insight' => $v->string('insight', required: true),
            'valueProposition' => $v->string('valueProposition', required: true),

            // Step 4 — Concept
            'centralIdea' => $v->string('centralIdea', required: true),
            'promise' => $v->string('promise', required: true),
            'mainMessage' => $v->string('mainMessage', required: true),
            'secondaryMessages' => $v->stringList('secondaryMessages'),
            'storytellingDirections' => $v->stringList('storytellingDirections'),
            'tone' => $v->string('tone'),
            'ctaCodes' => $v->stringList('ctaCodes'),

            // Step 5 — Produse și măsurare
            'products' => $v->stringList('products'),
            'productsIntro' => $v->string('productsIntro'),
            'productCondition' => $v->string('productCondition'),
            'channels' => $v->stringList('channels'),
            'prPartnerships' => $v->string('prPartnerships'),
            'kpiDefinitions' => $v->rows('kpiDefinitions', ['name', 'baseline', 'target', 'source']),

            // Step 6 — Reguli de adaptare
            'fixedElements' => $v->stringList('fixedElements'),
            'adaptableElements' => $v->stringList('adaptableElements'),
            'adaptationLimits' => $v->stringList('adaptationLimits'),
            'applicationExamples' => $v->rows('applicationExamples', ['context', 'adaptation', 'fixed']),

            // Step 7 — Livrabile
            'deliverableIntro' => $v->string('deliverableIntro'),
            'frameworkDeliverables' => $v->jsonList('frameworkDeliverables'),
            'headlines' => $v->jsonList('headlines'),
            'posts' => $v->jsonList('posts'),
            'videoConcepts' => $v->jsonList('videoConcepts'),
            'noVisualsNote' => $v->string('noVisualsNote'),
        ];

        if ($input['seasonalityMonths'] === []) {
            $v->fail('seasonalityMonths', 'Selectează cel puțin o lună de relevanță.');
        }

        // Step 8 — an object with two lists, not a list.
        $examples = $body['activationExamples'] ?? null;
        $input['activationExamples'] = [
            'directions' => is_array($examples['directions'] ?? null) ? array_values($examples['directions']) : [],
            'simulatedRows' => is_array($examples['simulatedRows'] ?? null) ? array_values($examples['simulatedRows']) : [],
        ];

        $v->check('Datele campaniei nu sunt valide.');

        return $input;
    }

    /**
     * Column order shared by INSERT and UPDATE, so the two cannot drift apart.
     *
     * @var list<string>
     */
    private const WRITE_COLUMNS = [
        'title', 'accent', 'campaign_type_id', 'status_id', 'pillar_id', 'seasonality_type_id',
        'seasonality_months', 'seasonality_note', 'version_label', 'responsible',
        'marketing_objective', 'direct_result', 'strategic_contribution',
        'primary_audience_description', 'central_idea', 'promise', 'main_message',
        'secondary_messages', 'tone', 'insight', 'value_proposition',
        'products', 'products_intro', 'product_condition', 'channels', 'pr_partnerships',
        'storytelling_directions', 'fixed_elements', 'adaptable_elements', 'adaptation_limits',
        'framework_deliverables', 'deliverable_intro', 'posts', 'headlines', 'video_concepts',
        'application_examples', 'kpi_definitions', 'activation_examples',
        'no_visuals_note', 'source_file', 'source_created_at_raw', 'source_updated_at_raw',
    ];

    private static function activeStrategyVersion(): string
    {
        $row = Db::one(
            "SELECT id FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1"
        );
        if ($row === null) {
            throw ApiError::validation(
                'Nu există o versiune strategică activă. Importă un pachet de campanii sau activează o versiune.'
            );
        }
        return (string) $row['id'];
    }

    /** Resolves a catalogue code to its id. The table name never comes from input. */
    public static function resolveCatalog(string $table, string $code, string $label): string
    {
        $row = Db::one("SELECT id FROM {$table} WHERE code = ? AND is_active = 1", [$code]);
        if ($row === null) {
            throw ApiError::validation("{$label}: valoarea „{$code}” nu există în nomenclator.");
        }
        return (string) $row['id'];
    }

    private static function resolveStrategic(
        string $table,
        string $strategyVersionId,
        string $code,
        string $label,
    ): string {
        $row = Db::one(
            "SELECT id FROM {$table} WHERE strategy_version_id = ? AND code = ? AND is_active = 1",
            [$strategyVersionId, $code],
        );
        if ($row === null) {
            throw ApiError::validation(
                "{$label}: codul „{$code}” nu există în versiunea strategică a campaniei."
            );
        }
        return (string) $row['id'];
    }

    /**
     * @param array<string,mixed> $input
     * @param array<string,string> $ids
     * @return list<mixed>
     */
    private static function writeValues(array $input, array $ids, string $timestamp): array
    {
        $json = static fn (mixed $value): string => json_encode($value ?? [], JSON_UNESCAPED_UNICODE) ?: '[]';

        return [
            $input['title'],
            $input['accent'],
            $ids['campaignTypeId'],
            $ids['statusId'],
            $ids['pillarId'],
            $ids['seasonalityTypeId'],
            $json($input['seasonalityMonths']),
            $input['seasonalityNote'],
            $input['version'],
            $input['responsible'],
            $input['marketingObjective'],
            $input['directResult'],
            $json($input['strategicContribution']),
            $input['primaryAudienceDescription'],
            $input['centralIdea'],
            $input['promise'],
            $input['mainMessage'],
            $json($input['secondaryMessages']),
            $input['tone'],
            $input['insight'],
            $input['valueProposition'],
            $json($input['products']),
            $input['productsIntro'],
            $input['productCondition'],
            $json($input['channels']),
            $input['prPartnerships'],
            $json($input['storytellingDirections']),
            $json($input['fixedElements']),
            $json($input['adaptableElements']),
            $json($input['adaptationLimits']),
            $json($input['frameworkDeliverables']),
            $input['deliverableIntro'],
            $json($input['posts']),
            $json($input['headlines']),
            $json($input['videoConcepts']),
            $json($input['applicationExamples']),
            $json($input['kpiDefinitions']),
            $json($input['activationExamples']),
            $input['noVisualsNote'],
            // Faithful to the Node original, including a known wart: this is in
            // WRITE_COLUMNS, so the first edit through the UI overwrites the
            // provenance of an imported campaign. Both backends behave the same
            // way; changing it here alone would make them disagree.
            'Creat în aplicație',
            $timestamp,
            $timestamp,
        ];
    }

    /** @param array<string,mixed> $input */
    private static function replaceRelations(
        string $campaignId,
        array $input,
        string $strategyVersionId,
        ?string $userId,
    ): void {
        foreach (['campaign_programs', 'campaign_objectives', 'campaign_audiences', 'campaign_ctas'] as $table) {
            Db::execute("DELETE FROM {$table} WHERE campaign_id = ?", [$campaignId]);
        }

        $program = self::resolveStrategic(
            'strategic_programs', $strategyVersionId, $input['programPrimaryCode'], 'Program principal'
        );
        Db::execute(
            "INSERT INTO campaign_programs (campaign_id, program_id, relation_role, sort_order, created_by)
             VALUES (?, ?, 'PRIMARY', 0, ?)",
            [$campaignId, $program, $userId],
        );
        foreach (array_values($input['programSecondaryCodes']) as $index => $code) {
            if ($code === $input['programPrimaryCode']) {
                continue;
            }
            $id = self::resolveStrategic('strategic_programs', $strategyVersionId, $code, 'Program secundar');
            Db::execute(
                "INSERT INTO campaign_programs (campaign_id, program_id, relation_role, sort_order, created_by)
                 VALUES (?, ?, 'SECONDARY', ?, ?)",
                [$campaignId, $id, $index + 1, $userId],
            );
        }

        $objective = self::resolveStrategic(
            'strategic_objectives', $strategyVersionId, $input['objectivePrimaryCode'], 'Obiectiv principal'
        );
        Db::execute(
            "INSERT INTO campaign_objectives (campaign_id, objective_id, relation_role, sort_order, created_by)
             VALUES (?, ?, 'PRIMARY', 0, ?)",
            [$campaignId, $objective, $userId],
        );
        foreach (array_values($input['objectiveSecondaryCodes']) as $index => $code) {
            if ($code === $input['objectivePrimaryCode']) {
                continue;
            }
            $id = self::resolveStrategic('strategic_objectives', $strategyVersionId, $code, 'Obiectiv secundar');
            Db::execute(
                "INSERT INTO campaign_objectives (campaign_id, objective_id, relation_role, sort_order, created_by)
                 VALUES (?, ?, 'SECONDARY', ?, ?)",
                [$campaignId, $id, $index + 1, $userId],
            );
        }

        $audience = self::resolveCatalog('audience_segments', $input['primaryAudienceCode'], 'Public principal');
        Db::execute(
            "INSERT INTO campaign_audiences (campaign_id, audience_segment_id, relation_role, sort_order, created_by)
             VALUES (?, ?, 'PRIMARY', 0, ?)",
            [$campaignId, $audience, $userId],
        );
        foreach (array_values($input['secondaryAudienceCodes']) as $index => $code) {
            if ($code === $input['primaryAudienceCode']) {
                continue;
            }
            $id = self::resolveCatalog('audience_segments', $code, 'Public secundar');
            Db::execute(
                "INSERT INTO campaign_audiences (campaign_id, audience_segment_id, relation_role, sort_order, created_by)
                 VALUES (?, ?, 'SECONDARY', ?, ?)",
                [$campaignId, $id, $index + 1, $userId],
            );
        }

        foreach (array_values($input['ctaCodes']) as $index => $code) {
            $id = self::resolveCatalog('cta_types', $code, 'CTA');
            Db::execute(
                'INSERT INTO campaign_ctas (campaign_id, cta_type_id, sort_order, created_by) VALUES (?, ?, ?, ?)',
                [$campaignId, $id, $index, $userId],
            );
        }
    }

    /**
     * @param array<string,mixed> $input
     * @return array{externalKey:string}
     */
    public static function create(array $input, ?string $userId): array
    {
        return Db::transaction(static function () use ($input, $userId): array {
            $strategyVersionId = self::activeStrategyVersion();
            $timestamp = gmdate('c');

            $ids = [
                'campaignTypeId' => self::resolveCatalog('campaign_types', $input['campaignTypeCode'], 'Tip campanie'),
                'statusId' => self::resolveCatalog('campaign_statuses', $input['statusCode'], 'Stadiu'),
                'pillarId' => self::resolveStrategic('strategic_pillars', $strategyVersionId, $input['pillarCode'], 'Pilon'),
                'seasonalityTypeId' => self::resolveCatalog('seasonality_types', $input['seasonalityTypeCode'], 'Sezonalitate'),
            ];

            $parentId = null;
            if (($input['parentCampaignExternalKey'] ?? null) !== null) {
                $parent = Db::one(
                    'SELECT id, strategy_version_id FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
                    [$input['parentCampaignExternalKey']],
                );
                if ($parent === null) {
                    throw ApiError::validation('Campania părinte nu a fost găsită.');
                }
                // parentCampaign expresses architecture within one cycle.
                if ((string) $parent['strategy_version_id'] !== $strategyVersionId) {
                    throw ApiError::validation(
                        'Campania părinte aparține altei versiuni strategice. Folosește „Continuă în noul ciclu strategic”.'
                    );
                }
                $parentId = (string) $parent['id'];
            }

            $id = Ids::newId();
            // Server-generated and immutable from here on.
            $externalKey = Ids::newExternalKey('camp');
            $family = $input['campaignFamilyExternalKey'] ?? ('family-' . $externalKey);

            $columns = implode(', ', self::WRITE_COLUMNS);
            $marks = implode(', ', array_fill(0, count(self::WRITE_COLUMNS), '?'));

            Db::execute(
                "INSERT INTO campaigns
                   (id, external_key, campaign_family_external_key, strategy_version_id, parent_campaign_id,
                    {$columns}, created_by)
                 VALUES (?, ?, ?, ?, ?, {$marks}, ?)",
                array_merge(
                    [$id, $externalKey, $family, $strategyVersionId, $parentId],
                    self::writeValues($input, $ids, $timestamp),
                    [$userId],
                ),
            );

            self::replaceRelations($id, $input, $strategyVersionId, $userId);

            Audit::write(
                userId: $userId,
                action: 'CREATE',
                entityType: 'CAMPAIGN',
                entityId: $id,
                entityExternalKey: $externalKey,
                newValues: ['title' => $input['title'], 'status' => $input['statusCode']],
            );

            return ['externalKey' => $externalKey];
        });
    }

    /** @param array<string,mixed> $input */
    public static function update(
        string $externalKey,
        array $input,
        ?int $expectedVersion,
        ?string $userId,
    ): void {
        Db::transaction(static function () use ($externalKey, $input, $expectedVersion, $userId): void {
            $existing = Db::one(
                'SELECT c.id, c.strategy_version_id, c.version_number, c.title,
                        st.code AS statusCode
                   FROM campaigns c
                   JOIN campaign_statuses st ON st.id = c.status_id
                  WHERE c.external_key = ? AND c.deleted_at IS NULL',
                [$externalKey],
            );
            if ($existing === null) {
                throw ApiError::notFound('Campania nu a fost găsită.');
            }

            $strategyVersionId = (string) $existing['strategy_version_id'];

            $ids = [
                'campaignTypeId' => self::resolveCatalog('campaign_types', $input['campaignTypeCode'], 'Tip campanie'),
                'statusId' => self::resolveCatalog('campaign_statuses', $input['statusCode'], 'Stadiu'),
                'pillarId' => self::resolveStrategic('strategic_pillars', $strategyVersionId, $input['pillarCode'], 'Pilon'),
                'seasonalityTypeId' => self::resolveCatalog('seasonality_types', $input['seasonalityTypeCode'], 'Sezonalitate'),
            ];

            $timestamp = gmdate('c');
            $assignments = implode(', ', array_map(
                static fn (string $column): string => $column . ' = ?',
                self::WRITE_COLUMNS,
            ));

            // Optimistic concurrency: the expected version travels in the WHERE
            // clause, so a concurrent edit makes this update match zero rows.
            $guard = $expectedVersion === null ? '' : ' AND version_number = ?';
            $params = array_merge(
                self::writeValues($input, $ids, $timestamp),
                [$userId, (string) $existing['id']],
                $expectedVersion === null ? [] : [$expectedVersion],
            );

            $affected = Db::execute(
                "UPDATE campaigns SET {$assignments}, version_number = version_number + 1, updated_by = ?
                  WHERE id = ?{$guard}",
                $params,
            );

            if ($affected === 0) {
                throw new ApiError(
                    'STALE_VERSION',
                    'Campania a fost modificată de alt utilizator. Reîncarcă datele înainte de salvare.',
                );
            }

            self::replaceRelations((string) $existing['id'], $input, $strategyVersionId, $userId);

            /*
             * The stage travels down to the activations.
             *
             * Inside this transaction on purpose: a campaign that reads `Draft`
             * while its activations still read `Activă` is a state the
             * operational screens will happily draw, and nothing later would
             * reconcile it. `ActivationCascade` holds the rule and the reason.
             */
            $cascaded = ActivationCascade::applyCampaignStatus(
                (string) $existing['id'],
                (string) $existing['statusCode'],
                $input['statusCode'],
                $userId,
            );

            Audit::write(
                userId: $userId,
                action: 'UPDATE',
                entityType: 'CAMPAIGN',
                entityId: (string) $existing['id'],
                entityExternalKey: $externalKey,
                oldValues: ['title' => $existing['title'], 'status' => $existing['statusCode']],
                newValues: array_filter([
                    'title' => $input['title'],
                    'status' => $input['statusCode'],
                    // Only when it happened — an empty count on every ordinary
                    // save would be noise in the trail.
                    'activariActualizate' => $cascaded > 0 ? $cascaded : null,
                ], static fn (mixed $value): bool => $value !== null),
            );
        });
    }
}
