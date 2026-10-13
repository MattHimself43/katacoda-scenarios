import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import type { BrandDetail } from '../../lib/types';
import { Button, ErrorBanner, Field, Modal, Notice, Spinner, Textarea, useToast } from '../ui';
import { EVIDENCE_LABELS } from '../../lib/brands';

/**
 * Confirmation for APPROVE / DECLINE. Loads the brand's current approval request so the
 * decision is bound to the exact content the reviewer sees here.
 */
export function BrandDecisionModal({
  brandId,
  kind,
  onClose,
  onDone,
}: {
  brandId: number | null;
  kind: 'approve' | 'decline';
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setNotes('');
    setError(null);
    if (brandId === null) return;
    api.get<BrandDetail>(`/api/brands/${brandId}`).then(setDetail, (e) => setError(errorMessage(e)));
  }, [brandId]);

  const confirm = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'approve') {
        await api.post(`/api/brands/${detail.brand.id}/approve`, { reviewedHash: detail.approval?.content_hash, notes: notes || null });
        toast('success', `${detail.brand.name} approved for outreach. A draft can now be prepared — nothing has been sent.`);
      } else {
        await api.post(`/api/brands/${detail.brand.id}/decline`, { notes: notes || null });
        toast('success', `${detail.brand.name} declined. It stays searchable and won't be rediscovered.`);
      }
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const b = detail?.brand;
  const partnership = detail?.evidence.filter((e) => e.evidence_type !== 'AFFILIATE_PROGRAM' && e.evidence_type !== 'OTHER') ?? [];

  return (
    <Modal
      open={brandId !== null}
      onClose={onClose}
      title={kind === 'approve' ? 'Approve brand for outreach' : 'Decline brand'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button variant={kind === 'approve' ? 'primary' : 'danger'} loading={busy} disabled={!detail} onClick={() => void confirm()}>
            {kind === 'approve' ? 'Approve for outreach' : 'Decline brand'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      {!detail && !error && <Spinner />}
      {b && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-base font-semibold">{b.name}</p>
            <p className="text-mute">{b.website_domain} · score {b.quality_score} · {b.discovery_niche} (v{b.settings_version})</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-mute">Contact</dt>
            <dd>{b.contact_email ? `${b.contact_email} (${b.contact_email_verified ? 'verified' : 'unverified'})` : b.contact_channel_url ? 'Official contact page only' : 'None'}</dd>
            <dt className="text-mute">Evidence</dt>
            <dd>
              {partnership.length
                ? `${partnership.length} partnership item${partnership.length === 1 ? '' : 's'} (${partnership.map((e) => EVIDENCE_LABELS[e.evidence_type]).join(', ')})`
                : 'Affiliate/other evidence only'}
            </dd>
          </dl>
          {kind === 'approve' ? (
            <Notice>Approval authorizes <strong>preparing an outreach draft only</strong>. No email is sent; every email needs its own administrator approval.</Notice>
          ) : (
            <Notice>Declined brands remain searchable and are never re-imported as new leads.</Notice>
          )}
          <Field label="Decision notes (optional)" htmlFor="brand-notes">
            <Textarea id="brand-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
