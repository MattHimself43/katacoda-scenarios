import type { ConfigChange } from '../../lib/types';
import { SETTING_LABELS, formatValue, FREQUENCY_LABELS, DISCOVERY_MODE_LABELS } from '../../lib/format';

export function displaySetting(key: string, v: unknown): string {
  if (key === 'researchFrequency' && typeof v === 'string') return FREQUENCY_LABELS[v] ?? v;
  if (key === 'discoveryMode' && typeof v === 'string') return DISCOVERY_MODE_LABELS[v] ?? v;
  return formatValue(v);
}

/** Old vs proposed values: side-by-side table on wider screens, stacked list on phones. */
export function ChangeTable({ changes }: { changes: ConfigChange[] }) {
  return (
    <>
      <ul className="divide-y divide-line text-sm sm:hidden">
        {changes.map((c) => (
          <li key={c.key} className="py-2.5">
            <p className="font-medium">{SETTING_LABELS[c.key] ?? c.key}</p>
            <p className="mt-1 text-mute">
              <span className="text-xs uppercase tracking-wide">Current </span>
              <span className="line-through decoration-neutral-300">{displaySetting(c.key, c.from)}</span>
            </p>
            <p className="mt-0.5">
              <span className="text-xs uppercase tracking-wide text-mute">Proposed </span>
              <span className="font-medium">{displaySetting(c.key, c.to)}</span>
            </p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-mute">
            <th className="py-2 pr-4 font-medium">Setting</th>
            <th className="py-2 pr-4 font-medium">Current</th>
            <th className="py-2 font-medium">Proposed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {changes.map((c) => (
            <tr key={c.key} className="align-top">
              <td className="py-2.5 pr-4 font-medium">{SETTING_LABELS[c.key] ?? c.key}</td>
              <td className="py-2.5 pr-4 text-mute line-through decoration-neutral-300">{displaySetting(c.key, c.from)}</td>
              <td className="py-2.5 font-medium">{displaySetting(c.key, c.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
