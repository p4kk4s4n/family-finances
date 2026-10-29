const RULES: Array<{ re: RegExp; category: string }> = [
  { re: /\b(banana|apple|orange|lemon|lime|avocado|tomato|potato|onion|garlic|lettuce|spinach|broccoli|carrot|berry|strawberry|grape|fruit|produce|salad|maçã|maca|laranja|limão|limao|tomate|batata|cebola|alho|alface|cenoura|fruta|verdura|legume|hortifruti)\b/i, category: 'Produce' },
  { re: /\b(chicken|beef|pork|steak|ground|turkey|bacon|sausage|ham|salmon|shrimp|fish|meat|frango|carne|boi|bovina|suína|suina|linguiça|linguica|presunto|peixe|salmão|salmao|camarão|camarao|acém|picanha)\b/i, category: 'Meat & Seafood' },
  { re: /\b(milk|egg|eggs|cheese|butter|yogurt|cream|dairy|leite|ovo|ovos|queijo|manteiga|requeijão|requeijao|iogurte|creme de leite|mussarela)\b/i, category: 'Dairy & Eggs' },
  { re: /\b(bread|bagel|muffin|croissant|roll|bun|tortilla|bakery|cake|pão|pao|padaria|bolo|bisnaguinha|torrada)\b/i, category: 'Bakery' },
  { re: /\b(frozen|ice cream|popsicle|pizza congelad|lasanha congelad|sorvete|congelad)\b/i, category: 'Frozen' },
  { re: /\b(rice|beans|pasta|spaghetti|noodle|flour|sugar|oil|olive oil|salt|sauce|soup|cereal|oats|oatmeal|honey|peanut butter|canned|tuna|arroz|feijão|feijao|macarrão|macarrao|farinha|açúcar|acucar|óleo|oleo|azeite|sal|molho|aveia|café pilão|cafe pilao|café|cafe|grão|grao)\b/i, category: 'Pantry Staples' },
  { re: /\b(chip|chips|cookie|chocolate|candy|snack|popcorn|pretzel|cracker|reeses|oreo|doritos|biscoito|bolacha|bombom|salgadinho|pipoca|doce)\b/i, category: 'Snacks & Treats' },
  { re: /\b(soda|cola|pepsi|coke|sprite|juice|water|sparkling|gatorade|tea|energy drink|refrigerante|suco|água|agua|guaraná|guarana|chá|cha)\b/i, category: 'Beverages' },
  { re: /\b(beer|wine|vodka|whiskey|gin|tequila|rum|cider|cerveja|vinho|cachaça|cachaca)\b/i, category: 'Alcohol' },
  { re: /\b(detergent|tide|bleach|soap|dish|sponge|paper towel|toilet paper|trash bag|cleaner|foil|napkin|sabão|sabao|detergente|amaciante|água sanitária|papel higiênico|papel toalha|saco de lixo|esponja|limpeza)\b/i, category: 'Household Supplies' },
  { re: /\b(shampoo|conditioner|toothpaste|toothbrush|deodorant|lotion|razor|body wash|sabonete|pasta de dente|creme dental|desodorante|hidratante|absorvente)\b/i, category: 'Personal Care' },
  { re: /\b(vitamin|tylenol|ibuprofen|advil|allergy|bandage|medicine|pharmacy|dipirona|paracetamol|remédio|remedio|farmácia|farmacia)\b/i, category: 'Health & Pharmacy' },
  { re: /\b(diaper|wipes|formula|baby|fralda|lenço umedecido|infantil)\b/i, category: 'Baby & Kids' },
  { re: /\b(dog|cat|pet|kibble|litter|ração|racao)\b/i, category: 'Pets' },
  { re: /\b(latte|cappuccino|espresso|frappuccino|starbucks|dunkin)\b/i, category: 'Coffee' },
  { re: /\b(burger|combo|fries|restaurant|dine|tip|gratuity|delivery|lanchonete|restaurante|rodízio)\b/i, category: 'Dining Out' },
  { re: /\b(shirt|pants|jeans|socks|shoes|jacket|dress|camisa|calça|meia|sapato|roupa)\b/i, category: 'Clothing' },
  { re: /\b(battery|cable|charger|adapter|usb|headphone|pilha|cabo|carregador)\b/i, category: 'Electronics' },
  { re: /\b(gas|fuel|unleaded|diesel|gallon|gasolina|etanol|combustível|combustivel|posto)\b/i, category: 'Fuel & Transport' },
];

/** Map an item name (English or Portuguese) to the closest budget category. */
export function categorizeItemText(name: string): string {
  const s = (name || '').toLowerCase();
  for (const r of RULES) {
    if (r.re.test(s)) return r.category;
  }
  return 'Other';
}
