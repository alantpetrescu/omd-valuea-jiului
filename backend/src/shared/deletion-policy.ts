/**
 * Deletion & Referential Integrity Policy — spec section 35.1.
 *
 * The rule that shapes everything here: an entity with history is never
 * deleted. Finishing work is expressed with the CLOSED status, not by removing
 * the record. Only an accidental, unused DRAFT may be soft-deleted.
 *
 * Dependency counts include CLOSED, inactive and soft-deleted rows — anything
 * that physically still holds a reference. Counting only what the UI currently
 * lists would let a delete quietly break history.
 */
import { execute, queryOne, withTransaction } from '../database/db';
import { ApiError } from './http';
import { writeAudit } from '../audit/audit-service';

export interface Dependency {
  type: string;
  count: number;
}

export interface DeletionAssessment {
  canDelete: boolean;
  canClose: boolean;
  dependencies: Dependency[];
  /** Why deletion is refused, phrased for the user. */
  reason: string | null;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const row = await queryOne<{ total: number }>(sql, params as never);
  return row?.total ?? 0;
}

export async function assessCampaignDeletion(campaignId: string): Promise<DeletionAssessment> {
  const dependencies: Dependency[] = [];

  const checks: Array<[string, string]> = [
    ['ACTIVATION', 'SELECT COUNT(*) AS total FROM activations WHERE campaign_id = ?'],
    ['ANNUAL_PLAN', 'SELECT COUNT(*) AS total FROM annual_plan_campaigns WHERE campaign_id = ?'],
    ['CHILD_CAMPAIGN', 'SELECT COUNT(*) AS total FROM campaigns WHERE parent_campaign_id = ?'],
    ['SUCCESSOR_CAMPAIGN', 'SELECT COUNT(*) AS total FROM campaigns WHERE supersedes_campaign_id = ?'],
    ['TEMPLATE_USED_BY_MATERIAL',
      'SELECT COUNT(*) AS total FROM activation_materials WHERE template_campaign_id = ?'],
  ];

  for (const [type, sql] of checks) {
    const total = await count(sql, [campaignId]);
    if (total > 0) dependencies.push({ type, count: total });
  }

  const blocked = dependencies.length > 0;
  return {
    canDelete: !blocked,
    canClose: true,
    dependencies,
    reason: blocked
      ? 'Campania nu poate fi ștearsă deoarece are istoric în sistem. ' +
        'Dacă activitatea s-a încheiat, schimbă stadiul în „Încheiată”.'
      : null,
  };
}

export async function assessActivationDeletion(activationId: string): Promise<DeletionAssessment> {
  const dependencies: Dependency[] = [];

  const checks: Array<[string, string]> = [
    ['ANNUAL_PLAN', 'SELECT COUNT(*) AS total FROM annual_plan_activations WHERE activation_id = ?'],
    ['PERFORMANCE_SNAPSHOT',
      'SELECT COUNT(*) AS total FROM material_performance_snapshots WHERE activation_id = ?'],
  ];

  for (const [type, sql] of checks) {
    const total = await count(sql, [activationId]);
    if (total > 0) dependencies.push({ type, count: total });
  }

  const blocked = dependencies.length > 0;
  return {
    canDelete: !blocked,
    canClose: true,
    dependencies,
    reason: blocked
      ? 'Activarea nu poate fi ștearsă deoarece are istoric în sistem. ' +
        'Dacă s-a încheiat, schimbă stadiul în „Încheiată”.'
      : null,
  };
}

/**
 * Soft-deletes a campaign after re-running the dependency check.
 *
 * The re-check is required, not defensive style: the preview the user saw may
 * be seconds old and an activation could have been created meanwhile.
 */
export async function softDeleteCampaign(
  externalKey: string,
  userId: string | null,
): Promise<void> {
  await withTransaction(async (connection) => {
    const campaign = await queryOne<{ id: string; title: string }>(
      'SELECT id, title FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
      [externalKey],
      connection,
    );
    if (!campaign) throw ApiError.notFound('Campania nu a fost găsită.');

    const assessment = await assessCampaignDeletion(campaign.id);
    if (!assessment.canDelete) {
      throw new ApiError('ENTITY_IN_USE', assessment.reason!, {
        entityType: 'CAMPAIGN',
        externalKey,
        dependencies: assessment.dependencies,
        allowedAction: 'CLOSE',
      });
    }

    await execute(
      'UPDATE campaigns SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ? WHERE id = ?',
      [userId, campaign.id],
      connection,
    );

    await writeAudit(
      { userId, action: 'SOFT_DELETE', entityType: 'CAMPAIGN', entityId: campaign.id,
        entityExternalKey: externalKey, oldValues: { title: campaign.title } },
      connection,
    );
  });
}

export async function softDeleteActivation(
  externalKey: string,
  userId: string | null,
): Promise<void> {
  await withTransaction(async (connection) => {
    const activation = await queryOne<{ id: string; title: string }>(
      'SELECT id, title FROM activations WHERE external_key = ? AND deleted_at IS NULL',
      [externalKey],
      connection,
    );
    if (!activation) throw ApiError.notFound('Activarea nu a fost găsită.');

    const assessment = await assessActivationDeletion(activation.id);
    if (!assessment.canDelete) {
      throw new ApiError('ENTITY_IN_USE', assessment.reason!, {
        entityType: 'ACTIVATION',
        externalKey,
        dependencies: assessment.dependencies,
        allowedAction: 'CLOSE',
      });
    }

    // Owned children without history go with the parent, in the same
    // transaction — they have no meaning on their own.
    await execute(
      'UPDATE activation_materials SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ? WHERE activation_id = ?',
      [userId, activation.id],
      connection,
    );
    await execute(
      'UPDATE activation_kpis SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ? WHERE activation_id = ?',
      [userId, activation.id],
      connection,
    );
    await execute(
      'UPDATE activations SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ? WHERE id = ?',
      [userId, activation.id],
      connection,
    );

    await writeAudit(
      { userId, action: 'SOFT_DELETE', entityType: 'ACTIVATION', entityId: activation.id,
        entityExternalKey: externalKey, oldValues: { title: activation.title } },
      connection,
    );
  });
}

/** Restores a soft-deleted entity. ADMIN only at the route level. */
export async function restoreEntity(
  table: 'campaigns' | 'activations',
  externalKey: string,
  userId: string | null,
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE external_key = ? AND deleted_at IS NOT NULL`,
    [externalKey],
  );
  if (!row) throw ApiError.notFound('Nu există o înregistrare ștearsă cu această cheie.');

  await execute(`UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL WHERE id = ?`, [row.id]);

  await writeAudit({
    userId,
    action: 'RESTORE',
    entityType: table === 'campaigns' ? 'CAMPAIGN' : 'ACTIVATION',
    entityId: row.id,
    entityExternalKey: externalKey,
  });
}
