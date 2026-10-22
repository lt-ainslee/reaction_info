// GHS pictogram codes and Chinese names, keyed by PubChem's English label.
export const GHS: Record<string, [code: string, zh: string]> = {
  Explosive: ['GHS01', '爆炸物'],
  Flammable: ['GHS02', '易燃'],
  Oxidizer: ['GHS03', '氧化性'],
  'Compressed Gas': ['GHS04', '压缩气体'],
  Corrosive: ['GHS05', '腐蚀性'],
  'Acute Toxic': ['GHS06', '急性毒性'],
  Irritant: ['GHS07', '刺激性/有害'],
  'Health Hazard': ['GHS08', '健康危害'],
  'Environmental Hazard': ['GHS09', '环境危害'],
};
