import { formatCalculatedNumber, parseNumericInput } from '@/lib/dateTime'
import { ABG_ACTUAL_FIO2_KEY, ABG_DESIRED_FIO2_KEY, ABG_PF_RATIO_KEY, ABG_PO2_KEY, DEFAULT_ABG_DESIRED_PAO2 } from './labTemplates'

/** The ABG values PUHRR calculates rather than takes as typed: pO2/FiO2 ratio, and the FiO2 that
 * would bring pO2 to the target (shown only when FiO2 is above room air or pO2 is low). Blank when
 * the inputs aren't there. */
export const computeAbgDerivedValues = (values: Record<string, string | undefined>): { pfRatio: string; desiredFiO2: string } => {
  const actualPaO2 = parseNumericInput(values[ABG_PO2_KEY])
  const actualFiO2Percent = parseNumericInput(values[ABG_ACTUAL_FIO2_KEY])

  const pfRatio =
    actualPaO2 !== null && actualFiO2Percent !== null && actualFiO2Percent > 0
      ? formatCalculatedNumber(actualPaO2 / (actualFiO2Percent / 100), 2)
      : ''

  const desiredFiO2 =
    actualPaO2 !== null &&
    actualPaO2 > 0 &&
    actualFiO2Percent !== null &&
    (actualFiO2Percent > 21 || actualPaO2 < 60)
      ? formatCalculatedNumber((actualFiO2Percent * DEFAULT_ABG_DESIRED_PAO2) / actualPaO2, 2)
      : ''

  return { pfRatio, desiredFiO2 }
}

/** Fills in the calculated ABG fields of a lab entry's results, the way the entry form does. */
export const withAbgDerivedValues = (results: Record<string, string>): Record<string, string> => {
  const { pfRatio, desiredFiO2 } = computeAbgDerivedValues(results)
  const next = { ...results }
  if (pfRatio) next[ABG_PF_RATIO_KEY] = pfRatio
  else delete next[ABG_PF_RATIO_KEY]
  if (desiredFiO2) next[ABG_DESIRED_FIO2_KEY] = desiredFiO2
  else delete next[ABG_DESIRED_FIO2_KEY]
  return next
}
