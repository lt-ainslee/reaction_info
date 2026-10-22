// Modal preview for one attachment: Bruker 1D spectrum, PDF, image, or info.
import { useEffect, useState } from 'react';
import { fileUrl, formatSize, type Attachment } from '../attachments/api';
import type { BrukerData } from '../attachments/spectrumFromZip';
import { brukerFromZip } from '../attachments/spectrumFromZip';
import { useI18n } from '../i18n';
import { NmrMetaLine } from './NmrMetaLine';
import { SpectrumView } from './SpectrumView';

export function AttachmentViewer({ att, onClose }: { att: Attachment; onClose: () => void }) {
  const { t } = useI18n();
  const [nmr, setNmr] = useState<BrukerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPdf = att.kind === 'pdf' || att.contentType === 'application/pdf';
  const isImage = att.kind === 'image' || att.contentType?.startsWith('image/');
  const isBruker = att.kind === 'nmr' && att.filename.toLowerCase().endsWith('.zip');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!isBruker) return;
    let cancelled = false;
    fetch(fileUrl(att.id))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => !cancelled && setNmr(brukerFromZip(new Uint8Array(buf))))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [att.id, isBruker]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal viewer-modal">
        <header>
          <h3>{att.filename}</h3>
          <span className="hint grow">
            <NmrMetaLine att={att} /> · {formatSize(att.size)}
          </span>
          <a className="button-like ghost" href={fileUrl(att.id, true)} download>{t.att.download}</a>
          <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
        </header>
        <div className="viewer-body">
          {isBruker &&
            (error ? (
              <p className="warn">{t.att.readFailed}: {error}</p>
            ) : !nmr ? (
              <p className="muted center">{t.att.loadingSpectrum}</p>
            ) : nmr.spectrum ? (
              <SpectrumView spectrum={nmr.spectrum} />
            ) : (
              <p className="muted center">{nmr.meta.dims === 2 ? t.att.no2d : t.att.noProcessed}</p>
            ))}
          {isPdf && <iframe className="viewer-frame" src={fileUrl(att.id)} title={att.filename} />}
          {isImage && <img className="viewer-img" src={fileUrl(att.id)} alt={att.filename} />}
          {!isBruker && !isPdf && !isImage && (
            <p className="muted center">{att.kind === 'mnova' ? t.att.mnovaHint : t.att.noPreview}</p>
          )}
          {att.note && <p className="viewer-note">{att.note}</p>}
        </div>
      </div>
    </div>
  );
}
