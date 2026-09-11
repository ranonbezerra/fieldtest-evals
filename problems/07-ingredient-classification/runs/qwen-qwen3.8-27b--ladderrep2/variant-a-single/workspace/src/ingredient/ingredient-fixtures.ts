// ASSUMPTION: the task refers to "provided synonym fixtures" but no fixture file
// was attached, so this repository ships a representative INCI fixture set
// covering synonyms, accent variants and common OCR typos. The official fixture
// file can replace this one without any code change.
export interface IngredientFixture {
  canonicalName: string;
  /** Surface forms (synonyms, regional spellings, OCR typos) resolving to the canonical ingredient. */
  variants: string[];
}

export const INGREDIENT_FIXTURES: IngredientFixture[] = [
  { canonicalName: 'Water', variants: ['Aqua', 'Eau'] },
  { canonicalName: 'Butylene Glycol', variants: ['Butylene Glycoll', 'Butyleneglycol'] },
  { canonicalName: 'Glycerin', variants: ['Glycerine', 'Glycerol'] },
  { canonicalName: 'Sodium Hyaluronate', variants: ['Hyaluronic Acid'] },
  { canonicalName: 'Fragrance', variants: ['Parfum', 'Parfüm', 'Aroma'] },
  { canonicalName: 'Methylisothiazolinone', variants: ['MIT'] },
  { canonicalName: 'Methylparaben', variants: ['Methyl Paraben'] },
  { canonicalName: 'Limonene', variants: ['Limonne'] },
  { canonicalName: 'Retinyl Palmitate', variants: ['Retinyl Pamitate'] },
  { canonicalName: 'Cocamidopropyl Betaine', variants: ['Cocamidopropyl Betain'] },
  { canonicalName: 'Aloe Barbadensis Leaf Juice', variants: ['Aloe Vera Leaf Juice', 'Aloe Barbaddensis Leaf Juice'] },
  { canonicalName: 'Propylene Glycol', variants: ['Proplyene Glycol'] },
  { canonicalName: 'Tocopherol', variants: ['Tocopherol', 'Vitamin E'] },
  { canonicalName: 'Ascorbic Acid', variants: ['Vitamin C'] },
];
