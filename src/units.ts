// Display units. Internal values are mmol / mg / µL.
export const AMOUNT_UNITS = { µmol: 1e-3, mmol: 1, mol: 1e3 } as const;
export const MASS_UNITS = { mg: 1, g: 1e3, kg: 1e6 } as const;
export const VOLUME_UNITS = { µL: 1, mL: 1e3, L: 1e6 } as const;

export type AmountUnit = keyof typeof AMOUNT_UNITS;
export type MassUnit = keyof typeof MASS_UNITS;
export type VolumeUnit = keyof typeof VOLUME_UNITS;

export interface Units { amount: AmountUnit; mass: MassUnit; volume: VolumeUnit }
export const DEFAULT_UNITS: Units = { amount: 'mmol', mass: 'mg', volume: 'mL' };

/** Format with `sig` significant figures, without exponent notation for lab-scale numbers. */
export function fmt(v: number | undefined, sig = 4): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-4) return v.toPrecision(sig);
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  return v.toFixed(Math.min(digits, 6)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
