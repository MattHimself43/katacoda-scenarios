import type { QualityBreakdown } from '../../lib/types';
import { SCORE_PARTS } from '../../lib/brands';

export function ScorePill({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-mute">—</span>;
  return (
    <span className="tabular inline-flex h-7 min-w-10 items-center justify-center rounded-lg bg-ink px-2 text-sm font-semibold text-white">
      {score}
    </span>
  );
}

export function ScoreBreakdown({ breakdown }: { breakdown: Partial<QualityBreakdown> }) {
  return (
    <div className="space-y-2.5">
      {SCORE_PARTS.map(([key, label, max]) => {
        const v = (breakdown[key] as number | undefined) ?? 0;
        return (
          <div key={key}>
            <div className="flex justify-between text-xs">
              <span className="text-mute">{label}</span>
              <span className="tabular font-medium">
                {v}/{max}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100" role="presentation">
              <div className="h-full rounded-full bg-ink" style={{ width: `${(v / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
      {breakdown.notes && breakdown.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 pt-1 text-xs text-mute">
          {breakdown.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}
