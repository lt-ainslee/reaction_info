import type { Attachment } from '../attachments/api';
import { prettyNucleus, prettySolvent } from '../attachments/bruker';
import { useI18n } from '../i18n';

/** "¹H · CDCl₃ · 400 MHz · zg30 · expno 1" for NMR; the kind label otherwise. */
export function NmrMetaLine({ att }: { att: Attachment }) {
  const { t } = useI18n();
  const m = att.meta as Record<string, string | number | undefined>;
  if (att.kind !== 'nmr') return <>{t.att.kinds[att.kind]}</>;
  const nuc = typeof m.nucleus === 'string' ? m.nucleus.split('/').map(prettyNucleus).join('–') : undefined;
  const parts = [
    nuc && `${nuc}${m.dims === 2 ? ' 2D' : ''}`,
    prettySolvent(m.solvent as string | undefined),
    m.fieldMHz && `${m.fieldMHz} MHz`,
    m.pulseProgram,
    m.expno && `expno ${m.expno}`,
  ].filter(Boolean);
  return <>{parts.join(' · ') || t.att.kinds.nmr}</>;
}
