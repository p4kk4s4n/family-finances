export interface CategoryDef {
  name: string;
  discretionary: boolean;
  defaultBudget: number; // USD / month
  emoji: string;
}

export const CATEGORIES: CategoryDef[] = [
  { name: 'Produce', discretionary: false, defaultBudget: 120, emoji: '🥦' },
  { name: 'Meat & Seafood', discretionary: false, defaultBudget: 120, emoji: '🥩' },
  { name: 'Dairy & Eggs', discretionary: false, defaultBudget: 60, emoji: '🥚' },
  { name: 'Pantry Staples', discretionary: false, defaultBudget: 100, emoji: '🥫' },
  { name: 'Bakery', discretionary: false, defaultBudget: 30, emoji: '🍞' },
  { name: 'Frozen', discretionary: false, defaultBudget: 40, emoji: '🧊' },
  { name: 'Snacks & Treats', discretionary: true, defaultBudget: 40, emoji: '🍫' },
  { name: 'Beverages', discretionary: true, defaultBudget: 40, emoji: '🥤' },
  { name: 'Alcohol', discretionary: true, defaultBudget: 30, emoji: '🍷' },
  { name: 'Household Supplies', discretionary: false, defaultBudget: 50, emoji: '🧽' },
  { name: 'Personal Care', discretionary: false, defaultBudget: 40, emoji: '🧴' },
  { name: 'Health & Pharmacy', discretionary: false, defaultBudget: 40, emoji: '💊' },
  { name: 'Baby & Kids', discretionary: false, defaultBudget: 50, emoji: '🧸' },
  { name: 'Pets', discretionary: false, defaultBudget: 40, emoji: '🐾' },
  { name: 'Dining Out', discretionary: true, defaultBudget: 120, emoji: '🍽️' },
  { name: 'Coffee', discretionary: true, defaultBudget: 30, emoji: '☕' },
  { name: 'Clothing', discretionary: true, defaultBudget: 50, emoji: '👕' },
  { name: 'Electronics', discretionary: true, defaultBudget: 30, emoji: '🔌' },
  { name: 'Fuel & Transport', discretionary: false, defaultBudget: 150, emoji: '⛽' },
  { name: 'Other', discretionary: true, defaultBudget: 50, emoji: '🧾' },
];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

export function categoryDef(name: string): CategoryDef {
  return CATEGORIES.find((c) => c.name === name) ?? CATEGORIES[CATEGORIES.length - 1];
}

export function normalizeCategory(name: string | undefined | null): string {
  if (!name) return 'Other';
  const hit = CATEGORIES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  return hit ? hit.name : 'Other';
}
