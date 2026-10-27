import { filters } from 'fabric';
import { normalizedAdjustment, sharpenMatrix, temperatureMatrix } from './tools';
import type { Adjustments } from './looks';

/** Fabric filter list for a Studio look; the editor and the batch compositor share it so exports match. */
export function adjustmentFilters(adjustments: Adjustments): object[] {
  const list: object[] = [
    new filters.Brightness({ brightness: normalizedAdjustment(adjustments.exposure) }),
    new filters.Brightness({ brightness: normalizedAdjustment(adjustments.brightness) }),
    new filters.Contrast({ contrast: normalizedAdjustment(adjustments.contrast) }),
    new filters.Saturation({ saturation: normalizedAdjustment(adjustments.saturation) }),
    new filters.ColorMatrix({ matrix: temperatureMatrix(adjustments.temperature) }),
  ];
  if (adjustments.sharpness) list.push(new filters.Convolute({ matrix: sharpenMatrix(adjustments.sharpness) }));
  if (adjustments.preset === 'grayscale') list.push(new filters.Grayscale());
  if (adjustments.preset === 'sepia') list.push(new filters.Sepia());
  return list;
}
