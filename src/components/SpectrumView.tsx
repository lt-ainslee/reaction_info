// Interactive 1D spectrum: drag to zoom into a ppm range, double-click to reset.
import { useMemo, useRef, useState } from 'react';
import type { Spectrum } from '../attachments/bruker';
import { autoRange, spectrumPath, ticks } from '../attachments/plot';
import { useI18n } from '../i18n';

const W = 900;
const H = 320;
const AXIS = 26;

export function SpectrumView({ spectrum }: { spectrum: Spectrum }) {
  const { t } = useI18n();
  const initial = useMemo(() => autoRange(spectrum), [spectrum]);
  const full: [number, number] = [spectrum.ppm[0], spectrum.ppm[spectrum.ppm.length - 1]];
  const [win, setWin] = useState<[number, number]>(initial);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const path = useMemo(() => spectrumPath(spectrum, { left: win[0], right: win[1], width: W, height: H - AXIS, pad: 8 }), [spectrum, win]);
  const toPpm = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return win[0] - fx * (win[0] - win[1]);
  };
  const toX = (ppm: number) => ((win[0] - ppm) / (win[0] - win[1])) * W;

  return (
    <div className="spectrum">
      <div className="spectrum-bar">
        <span className="muted small">{t.att.zoomHint}</span>
        <span className="grow" />
        {hover !== null && <span className="mono small">δ {hover.toFixed(3)}</span>}
        <button className="ghost small" onClick={() => setWin(initial)}>{t.att.autoRange}</button>
        <button className="ghost small" onClick={() => setWin(full)}>{t.att.fullRange}</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="spectrum-svg"
        onMouseDown={(e) => {
          const p = toPpm(e.clientX);
          setDrag([p, p]);
        }}
        onMouseMove={(e) => {
          const p = toPpm(e.clientX);
          setHover(p);
          if (drag) setDrag([drag[0], p]);
        }}
        onMouseLeave={() => {
          setHover(null);
          setDrag(null);
        }}
        onMouseUp={() => {
          if (drag && Math.abs(drag[0] - drag[1]) > Math.abs(win[0] - win[1]) / 200) {
            setWin([Math.max(drag[0], drag[1]), Math.min(drag[0], drag[1])]);
          }
          setDrag(null);
        }}
        onDoubleClick={() => setWin(initial)}
      >
        {drag && (
          <rect
            x={Math.min(toX(drag[0]), toX(drag[1]))}
            y={0}
            width={Math.abs(toX(drag[0]) - toX(drag[1]))}
            height={H - AXIS}
            className="spectrum-sel"
          />
        )}
        <path d={path} className="spectrum-line" />
        <line x1={0} x2={W} y1={H - AXIS} y2={H - AXIS} className="spectrum-axis" />
        {ticks(win[0], win[1], 10).map((v) => (
          <g key={v} transform={`translate(${toX(v)},${H - AXIS})`}>
            <line y2={5} className="spectrum-axis" />
            <text y={18} textAnchor="middle" className="spectrum-tick">{v}</text>
          </g>
        ))}
      </svg>
      <div className="spectrum-unit muted small">δ / ppm</div>
    </div>
  );
}
