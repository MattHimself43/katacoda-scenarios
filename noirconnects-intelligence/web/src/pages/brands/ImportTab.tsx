import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy, Download, Upload } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import type { ImportAnalysis, ImportRecord, SettingsResponse } from '../../lib/types';
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, Input, Modal, Notice, Textarea, statusTone, useToast } from '../../components/ui';
import { OUTCOME_LABELS } from '../../lib/brands';
import { formatDateTime } from '../../lib/format';

type Format = 'JSON' | 'CSV';

function buildPrompt(s: SettingsResponse): string {
  const c = s.active.config;
  return `You are researching brands for NoirConnects, an influencer marketing agency.

Configuration version: ${s.active.version}
Niche: ${s.active.effectiveNiche}
Target market: ${c.targetGeography}; language: ${c.targetLanguage}
Find up to ${c.dailyBrandTarget} companies with VERIFIABLE influencer marketing activity,
preferring evidence from the last ${c.sponsorshipRecencyMonths} months.${
    s.active.effectiveNiche === 'Gaming'
      ? `
Prioritise: gaming peripherals, PC hardware, monitors, controllers and accessories, chairs and
furniture, game publishers, gaming software/services, gaming lifestyle products, creator tools
and streaming equipment.`
      : ''
  }

Rules:
- Only include a brand if you found at least one public source URL showing creator sponsorship,
  an ambassador program, a creator partnership announcement, or (weaker) an affiliate program.
- Mark evidence "verified": true only if you opened the source and it confirms the claim.
- Distinguish PAID_SPONSORSHIP / AMBASSADOR_PROGRAM / CREATOR_ANNOUNCEMENT from AFFILIATE_PROGRAM.
- NEVER invent contact names, roles, email addresses, sponsorships, dates or budgets. If unknown,
  omit the field. If found but unconfirmed, include it with "verified": false.
- Prefer an official partnership email or contact page.
- Fewer, well-evidenced brands are better than reaching the target. Do not pad the list.
- Output ONLY a JSON object (no prose, no markdown) shaped like:
{"schemaVersion":"brand-research/v1","configVersion":${s.active.version},"niche":"${s.active.effectiveNiche}","generatedAt":"<ISO 8601 now>","producedBy":"Claude","brands":[{"name":"","website":"","industry":"","subcategory":"","targetMarkets":[],"productsServices":"","influencerActivitySummary":"","recommendationReason":"","researchedAt":"<ISO 8601>","contactName":{"value":"","verified":false},"contactRole":{"value":"","verified":false},"contactEmail":{"value":"","verified":false},"contactChannelUrl":"https://...","evidence":[{"type":"PAID_SPONSORSHIP","description":"","sourceUrl":"https://...","date":"YYYY-MM-DD","creatorName":"","platform":"","verified":true}]}]}
Omit any contact field you could not find rather than leaving it empty.`;
}

export function ImportTab({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const settings = useApi<SettingsResponse>('/api/settings');
  const [format, setFormat] = useState<Format>('JSON');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvMeta, setCsvMeta] = useState({ configVersion: 0, niche: '' });
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [acceptOutdated, setAcceptOutdated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [result, setResult] = useState<{ runId: number; imported: number } | null>(null);

  useEffect(() => {
    if (settings.data && !csvMeta.niche) {
      setCsvMeta({ configVersion: settings.data.active.version, niche: settings.data.active.effectiveNiche });
    }
  }, [settings.data, csvMeta.niche]);

  const reset = () => {
    setAnalysis(null);
    setInclude(new Set());
    setAcceptOutdated(false);
    setError(null);
  };

  const input = () => ({ format, content, fileName, csvMeta: format === 'CSV' ? csvMeta : null });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4_000_000) {
      setError('File is larger than 4 MB');
      return;
    }
    reset();
    setResult(null);
    setFileName(file.name);
    setFormat(/\.csv$/i.test(file.name) ? 'CSV' : 'JSON');
    setContent(await file.text());
  };

  const preview = async () => {
    setBusy(true);
    reset();
    setResult(null);
    try {
      const res = await api.post<{ analysis: ImportAnalysis }>('/api/research/brand-imports/preview', input());
      setAnalysis(res.analysis);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!analysis) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ runId: number; imported: unknown[] }>('/api/research/brand-imports/commit', {
        ...input(),
        expectedInputHash: analysis.inputHash,
        acceptOutdatedConfig: acceptOutdated,
        includePossibleDuplicates: [...include],
      });
      setConfirmOpen(false);
      setResult({ runId: res.runId, imported: res.imported.length });
      toast('success', `Research run #${res.runId}: ${res.imported.length} brand${res.imported.length === 1 ? '' : 's'} added to the approval queue.`);
      setContent('');
      setFileName(null);
      setAnalysis(null);
    } catch (e) {
      setConfirmOpen(false);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    if (!settings.data) return;
    try {
      await navigator.clipboard.writeText(buildPrompt(settings.data));
      toast('success', 'Research prompt copied to the clipboard.');
    } catch {
      toast('error', 'Clipboard is unavailable in this browser. Select the prompt text and copy it manually.');
    }
  };

  const downloadSchema = async () => {
    try {
      const res = await api.get<{ jsonSchema: unknown }>('/api/research/brand-schema');
      const url = URL.createObjectURL(new Blob([JSON.stringify(res.jsonSchema, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'brand-research-v1.schema.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const toImport = analysis ? analysis.summary.NEW + include.size : 0;
  const blocked = !analysis || analysis.fileErrors.length > 0 || !!analysis.alreadyImported || (analysis.config?.outdated && !acceptOutdated);

  return (
    <div className="space-y-6">
      {result && (
        <Notice>
          Research run #{result.runId} imported {result.imported} brand{result.imported === 1 ? '' : 's'}.{' '}
          <Link to="/brand-approvals" className="font-medium underline">Review them in Brand Approvals →</Link>{' '}
          <button className="font-medium underline" onClick={onImported}>See run history</button>
        </Notice>
      )}

      <Card>
        <CardHeader
          title="1. Provide research"
          description="Upload or paste a brand-research/v1 JSON file, or the CSV format. Nothing is saved until you confirm the import."
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-medium hover:border-neutral-400">
              <Upload className="size-4" aria-hidden /> Choose file
              <input type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(e) => void onFile(e)} />
            </label>
            <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Format">
              {(['JSON', 'CSV'] as const).map((f) => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => { setFormat(f); reset(); }}
                  className={`h-8 rounded-md px-3 text-sm ${format === f ? 'bg-ink text-white' : 'text-mute hover:text-ink'}`}
                >
                  {f}
                </button>
              ))}
            </div>
            {fileName && <span className="truncate text-sm text-mute">{fileName}</span>}
          </div>
          <Textarea
            aria-label="Research content"
            className="min-h-40 font-mono text-xs"
            placeholder={format === 'JSON' ? '{ "schemaVersion": "brand-research/v1", … }' : 'name,website,industry,…'}
            value={content}
            onChange={(e) => { setContent(e.target.value); setFileName(null); reset(); }}
          />
          {format === 'CSV' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Configuration version the research used" htmlFor="csv-ver">
                <Input id="csv-ver" type="number" min={1} value={csvMeta.configVersion || ''} onChange={(e) => { setCsvMeta({ ...csvMeta, configVersion: Number(e.target.value) }); reset(); }} />
              </Field>
              <Field label="Niche" htmlFor="csv-niche">
                <Input id="csv-niche" value={csvMeta.niche} onChange={(e) => { setCsvMeta({ ...csvMeta, niche: e.target.value }); reset(); }} />
              </Field>
            </div>
          )}
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end">
            <Button variant="primary" loading={busy && !confirmOpen} disabled={!content.trim()} onClick={() => void preview()}>
              Validate &amp; preview
            </Button>
          </div>
        </div>
        <div className="border-t border-line">
          <button className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium" onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen}>
            {helpOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Format &amp; Claude research prompt
          </button>
          {helpOpen && settings.data && (
            <div className="space-y-3 px-5 pb-5 text-sm">
              <p className="text-mute">
                The full format reference is in <code className="font-mono text-ink">docs/research/brand-research-v1.md</code>, with JSON and CSV examples alongside it.
                Paste the prompt below into Claude, then import its JSON output here. Claude cannot write into this dashboard directly.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void copyPrompt()}><Copy className="size-4" /> Copy prompt (v{settings.data.active.version})</Button>
                <Button onClick={() => void downloadSchema()}><Download className="size-4" /> Download JSON Schema</Button>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 font-mono text-xs">{buildPrompt(settings.data)}</pre>
            </div>
          )}
        </div>
      </Card>

      {analysis && (
        <Card>
          <CardHeader
            title="2. Review the preview"
            description={
              analysis.config
                ? `Configuration v${analysis.config.version} · ${analysis.config.niche} · minimum score ${analysis.config.minBrandQualityScore} · daily target ${analysis.config.dailyBrandTarget} (a target, not a quota)`
                : 'The file could not be validated.'
            }
          />
          <div className="space-y-4 p-5">
            {analysis.fileErrors.length > 0 && <ErrorBanner message={analysis.fileErrors.join(' · ')} />}
            {analysis.alreadyImported && (
              <ErrorBanner message={`This exact file was already imported in research run #${analysis.alreadyImported.runId} (${formatDateTime(analysis.alreadyImported.completedAt)}).`} />
            )}
            {analysis.fileWarnings.map((w) => (
              <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{w}</div>
            ))}
            {analysis.config?.outdated && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-black" checked={acceptOutdated} onChange={(e) => setAcceptOutdated(e.target.checked)} />
                I understand these brands will be imported under configuration v{analysis.config.version} ({analysis.config.niche}).
              </label>
            )}
            {analysis.records.length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm">
                {(['NEW', 'POSSIBLE_DUPLICATE', 'DUPLICATE', 'DUPLICATE_IN_FILE', 'BELOW_THRESHOLD', 'INVALID'] as const).map((k) => (
                  <span key={k} className="rounded-lg border border-line px-2.5 py-1">
                    <span className="tabular font-semibold">{analysis.summary[k]}</span> <span className="text-mute">{OUTCOME_LABELS[k]}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {analysis.records.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {analysis.records.map((r) => (
                <RecordRow
                  key={r.index}
                  record={r}
                  included={include.has(r.index)}
                  minScore={analysis.config?.minBrandQualityScore ?? 0}
                  onToggle={(on) => setInclude((s) => { const n = new Set(s); if (on) n.add(r.index); else n.delete(r.index); return n; })}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <p className="text-sm text-mute">
              {toImport} brand{toImport === 1 ? '' : 's'} will be added to Brand Approvals.
            </p>
            <Button variant="primary" disabled={blocked} onClick={() => setConfirmOpen(true)}>
              Import {toImport} brand{toImport === 1 ? '' : 's'}
            </Button>
          </div>
        </Card>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm import"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Back</Button>
            <Button variant="primary" loading={busy} onClick={() => void commit()}>Import now</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            Import <strong>{toImport}</strong> brand{toImport === 1 ? '' : 's'} as research run under configuration v{analysis?.config?.version} (
            {analysis?.config?.niche}). Each brand enters <strong>Pending approval</strong>.
          </p>
          {include.size > 0 && <p className="text-amber-800">Includes {include.size} possible duplicate{include.size === 1 ? '' : 's'} you selected.</p>}
          <Notice>No emails are drafted or sent by importing. Duplicates, invalid and below-threshold records are skipped and recorded in run history.</Notice>
        </div>
      </Modal>
    </div>
  );
}

function RecordRow({ record: r, included, minScore, onToggle }: { record: ImportRecord; included: boolean; minScore: number; onToggle: (on: boolean) => void }) {
  const [open, setOpen] = useState(r.outcome === 'INVALID');
  const canInclude = r.outcome === 'POSSIBLE_DUPLICATE' && (r.score?.total ?? 0) >= minScore;
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular w-6 text-xs text-mute">{r.index + 1}</span>
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <p className="truncate text-sm font-medium">{r.name ?? 'Unnamed record'}</p>
          <p className="truncate text-xs text-mute">
            {r.domain ?? r.website ?? '—'}
            {r.errors.length === 0 && ` · ${r.partnershipEvidence} partnership · ${r.affiliateEvidence} affiliate · ${r.verifiedEvidence} verified`}
          </p>
        </button>
        {r.score && <span className="tabular text-sm font-semibold">{r.score.total}</span>}
        <Badge tone={statusTone(r.outcome)}>{OUTCOME_LABELS[r.outcome]}</Badge>
        {canInclude && (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" className="size-4 accent-black" checked={included} onChange={(e) => onToggle(e.target.checked)} />
            Include
          </label>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-1 pl-9 text-xs">
          {r.errors.map((e) => <p key={e} className="text-red-700">✕ {e}</p>)}
          {r.existingBrand && (
            <p className="text-mute">
              Existing: <Link className="underline" to={`/brands/${r.existingBrand.id}`}>{r.existingBrand.name}</Link> ({r.existingBrand.domain}, {r.existingBrand.status})
            </p>
          )}
          {r.warnings.map((w) => <p key={w} className="text-amber-800">! {w}</p>)}
          {r.score && (
            <p className="text-mute">
              Score: evidence {r.score.evidence}/40 · recency {r.score.recency}/25 · contact {r.score.contactability}/15 · completeness {r.score.completeness}/10 · niche {r.score.nicheFit}/10
            </p>
          )}
        </div>
      )}
    </li>
  );
}
