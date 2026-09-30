/**
 * Resolves an Egyptian governorate out of a free-text address.
 *
 * Addresses arrive from Shopify as whatever the customer typed, so the same
 * governorate shows up as «الجيزه», «الجيزة», «6 اكتوبر», «Giza» or with a
 * stray letter dropped. Matching therefore runs in three passes, cheapest
 * first: exact alias hit on the normalized text, then alias hit on a
 * normalized token window, then a bounded edit-distance comparison so a
 * one-or-two letter slip still lands on the right governorate.
 */

const { GOVERNORATES } = require("../../../config/constants") as {
  GOVERNORATES: Record<string, string>;
};

/** القاهرة والجيزة — نطاق التوصيل الداخلي. */
export const CAIRO_GOVERNORATE_ID = 1;
export const GIZA_GOVERNORATE_ID = 2;
export const INSIDE_CAIRO_GIZA_IDS: readonly number[] = [
  CAIRO_GOVERNORATE_ID,
  GIZA_GOVERNORATE_ID,
];

/**
 * Extra spellings per governorate id, on top of the canonical label in
 * `config/constants`. Latin entries are matched lowercased; Arabic entries go
 * through the same normalizer as the address, so «الجيزة» here also covers
 * «الجيزه» and «جيزة».
 */
const GOVERNORATE_ALIASES: Record<number, string[]> = {
  1: [
    "القاهرة", "القاهره", "مصر الجديدة", "مدينة نصر", "المعادي", "حلوان",
    "شبرا", "عين شمس", "المرج", "التجمع", "التجمع الخامس", "القاهرة الجديدة",
    "الرحاب", "مدينتي", "الشروق", "بدر", "العبور", "المقطم", "الزمالك",
    "وسط البلد", "الزيتون", "المطرية", "السيدة زينب", "حدائق القبة",
    "cairo", "new cairo", "nasr city", "maadi", "heliopolis", "helwan",
  ],
  2: [
    "الجيزة", "جيزة", "الهرم", "فيصل", "الدقي", "المهندسين", "العجوزة",
    "6 اكتوبر", "السادس من اكتوبر", "اكتوبر", "الشيخ زايد", "زايد",
    "امبابة", "بولاق الدكرور", "الوراق", "كرداسة", "البدرشين", "الصف",
    "اطفيح", "العياط", "الحوامدية", "منشية القناطر", "ابو النمرس",
    "giza", "6th of october", "sheikh zayed", "dokki", "mohandessin", "haram",
  ],
  3: [
    "الاسكندرية", "اسكندرية", "سكندرية", "العجمي", "برج العرب", "سموحة",
    "المنتزه", "سيدي بشر", "محرم بك", "ميامي", "العامرية",
    "alexandria", "alex",
  ],
  4: ["الشرقية", "شرقية", "الزقازيق", "زقازيق", "بلبيس", "العاشر من رمضان", "منيا القمح", "ابو حماد", "فاقوس", "ههيا", "sharqia", "zagazig"],
  5: ["الدقهلية", "دقهلية", "ميت غمر", "السنبلاوين", "دكرنس", "بلقاس", "اجا", "منية النصر", "dakahlia"],
  6: ["البحيرة", "بحيرة", "دمنهور", "كفر الدوار", "رشيد", "ايتاي البارود", "ابو حمص", "كوم حمادة", "beheira", "damanhour"],
  7: ["الغربية", "غربية", "طنطا", "المحلة", "المحلة الكبرى", "كفر الزيات", "زفتى", "السنطة", "gharbia", "tanta", "mahalla"],
  8: ["المنيا", "منيا", "ملوي", "بني مزار", "مغاغة", "سمالوط", "minya", "menia"],
  9: ["المنوفية", "منوفية", "شبين الكوم", "شبين", "منوف", "اشمون", "قويسنا", "السادات", "بركة السبع", "menoufia", "monufia"],
  10: ["الفيوم", "فيوم", "سنورس", "ابشواي", "طامية", "اطسا", "fayoum", "faiyum"],
  11: ["القليوبية", "قليوبية", "بنها", "شبرا الخيمة", "قليوب", "الخانكة", "طوخ", "قها", "كفر شكر", "قليوبيه", "qalyubia", "banha", "shubra el kheima"],
  12: ["بني سويف", "بنى سويف", "الواسطى", "ببا", "الفشن", "ناصر", "beni suef"],
  13: ["اسيوط", "ديروط", "منفلوط", "ابنوب", "القوصية", "صدفا", "assiut", "asyut"],
  14: ["سوهاج", "طهطا", "جرجا", "اخميم", "البلينا", "المراغة", "sohag"],
  15: ["قنا", "نجع حمادي", "دشنا", "قوص", "ابو تشت", "فرشوط", "qena"],
  16: ["اسوان", "كوم امبو", "ادفو", "دراو", "نصر النوبة", "aswan"],
  17: ["الوادي الجديد", "وادي جديد", "الخارجة", "الداخلة", "الفرافرة", "باريس", "new valley", "kharga"],
  18: ["الاسماعيلية", "اسماعيلية", "فايد", "القنطرة", "التل الكبير", "ismailia"],
  19: ["بورسعيد", "بور سعيد", "بورفؤاد", "port said", "portsaid"],
  20: ["السويس", "سويس", "عتاقة", "الاربعين", "suez"],
  21: ["شمال سيناء", "العريش", "الشيخ زويد", "رفح", "بئر العبد", "north sinai", "arish"],
  22: ["جنوب سيناء", "شرم الشيخ", "شرم", "دهب", "نويبع", "طابا", "سانت كاترين", "راس سدر", "south sinai", "sharm", "sharm el sheikh", "dahab"],
  23: ["مطروح", "مرسى مطروح", "سيوة", "السلوم", "النجيلة", "marsa matrouh", "matrouh", "matruh"],
  24: ["البحر الاحمر", "الغردقة", "سفاجا", "القصير", "مرسى علم", "رأس غارب", "الجونة", "سهل حشيش", "red sea", "hurghada", "el gouna", "safaga", "marsa alam"],
  25: ["الاقصر", "اقصر", "اسنا", "ارمنت", "luxor"],
  26: [],
  27: ["دمياط", "راس البر", "فارسكور", "كفر سعد", "دمياط الجديدة", "damietta"],
  28: ["الساحل الشمالي", "ساحل شمالي", "سيدي عبد الرحمن", "مارينا", "العلمين", "north coast", "sahel", "alamein"],
  29: ["العين السخنة", "عين سخنة", "السخنة", "ain sokhna", "sokhna"],
  30: ["المنصورة", "منصورة", "طلخا", "mansoura"],
};

/** كفر الشيخ ليست في `GOVERNORATES` — تُحسب «محافظات» بلا معرّف. */
const UNLISTED_OUTSIDE_ALIASES = [
  "كفر الشيخ", "كفرالشيخ", "دسوق", "بلطيم", "فوه", "مطوبس", "سيدي سالم",
  "kafr el sheikh", "kafr elsheikh",
];

const ARABIC_DIACRITICS = /[ً-ْٰـ]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/**
 * Folds the spelling variants Arabic free text is full of: diacritics and
 * tatweel disappear, every alef/ya/ta-marbuta form collapses to one letter,
 * Arabic-Indic digits become Latin, and everything else becomes single spaces.
 */
export const normalizeArabic = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱا]/g, "ا")
    .replace(/[ىئي]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();
};

/** «ال» التعريف تسقط حتى يتطابق «الجيزة» مع «جيزة». */
const stripDefiniteArticle = (token: string): string =>
  token.length > 4 && token.startsWith("ال") ? token.slice(2) : token;

type AliasEntry = {
  governorateId: number | null;
  /** عدد الكلمات في الاسم — يحدد حجم النافذة عند المقارنة. */
  length: number;
  text: string;
};

const buildAliasIndex = (): AliasEntry[] => {
  const entries = new Map<string, AliasEntry>();

  const add = (rawAlias: string, governorateId: number | null): void => {
    const normalized = normalizeArabic(rawAlias);
    if (!normalized || normalized.length < 3) {
      return;
    }

    const words = normalized.split(" ").map(stripDefiniteArticle).filter(Boolean);
    const text = words.join(" ");
    if (!text || entries.has(text)) {
      return;
    }

    entries.set(text, { governorateId, length: words.length, text });
  };

  Object.entries(GOVERNORATES).forEach(([id, label]) => add(label, Number(id)));
  Object.entries(GOVERNORATE_ALIASES).forEach(([id, aliases]) => {
    aliases.forEach((alias) => add(alias, Number(id)));
  });
  UNLISTED_OUTSIDE_ALIASES.forEach((alias) => add(alias, null));

  /* Longest alias first: «شمال سيناء» must win over «سيناء», and «بني سويف»
     over a stray «بني». */
  return [...entries.values()].sort((left, right) => right.text.length - left.text.length);
};

const ALIAS_INDEX = buildAliasIndex();

/** `noUncheckedIndexedAccess` يجعل قراءة أي عنصر `number | undefined`. */
const cellAt = (row: number[], index: number): number => row[index] ?? 0;

/** Levenshtein مع سقف — يتوقف مبكراً بدل حساب المصفوفة كاملة. */
const editDistanceWithin = (left: string, right: string, maxDistance: number): number | null => {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return null;
  }

  let previousRow: number[] = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const currentRow: number[] = [i];
    let rowMinimum = i;

    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        cellAt(currentRow, j - 1) + 1,
        cellAt(previousRow, j) + 1,
        cellAt(previousRow, j - 1) + substitutionCost,
      );
      currentRow.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return null;
    }

    previousRow = currentRow;
  }

  const distance = cellAt(previousRow, right.length);
  return distance <= maxDistance ? distance : null;
};

/** كلمة قصيرة لا تحتمل خطأً، والأطول تحتمل حرفين. */
const toleranceFor = (text: string): number => {
  if (text.length <= 4) {
    return 0;
  }

  return text.length <= 7 ? 1 : 2;
};

const governorateLabel = (entry: AliasEntry): string => {
  if (entry.governorateId === null) {
    return entry.text;
  }

  return GOVERNORATES[String(entry.governorateId)] ?? entry.text;
};

export type GovernorateMatch = {
  /** `null` لمحافظة معروفة لكن بلا معرّف في `GOVERNORATES` (كفر الشيخ مثلاً). */
  governorateId: number | null;
  label: string;
  /** `exact` تطابق نصي، `fuzzy` تطابق بفارق حرف أو حرفين. */
  matchType: "exact" | "fuzzy";
  matchedAlias: string;
};

/**
 * Finds the governorate an address belongs to, or `null` when nothing matches
 * closely enough. An exact hit always beats a fuzzy one, and among fuzzy hits
 * the smallest edit distance on the longest alias wins.
 */
export const matchGovernorate = (address: unknown): GovernorateMatch | null => {
  const normalized = normalizeArabic(address);
  if (!normalized) {
    return null;
  }

  const words = normalized.split(" ").map(stripDefiniteArticle).filter(Boolean);
  if (words.length === 0) {
    return null;
  }

  const haystack = ` ${words.join(" ")} `;

  for (const entry of ALIAS_INDEX) {
    if (haystack.includes(` ${entry.text} `)) {
      return {
        governorateId: entry.governorateId,
        label: governorateLabel(entry),
        matchType: "exact",
        matchedAlias: entry.text,
      };
    }
  }

  let best: { distance: number; entry: AliasEntry } | null = null;

  for (const entry of ALIAS_INDEX) {
    const tolerance = toleranceFor(entry.text);
    if (tolerance === 0) {
      continue;
    }

    for (let start = 0; start + entry.length <= words.length; start += 1) {
      const window = words.slice(start, start + entry.length).join(" ");
      const distance = editDistanceWithin(window, entry.text, tolerance);
      if (distance === null) {
        continue;
      }

      /* Longer aliases are more specific, so they win ties on distance. */
      if (
        !best
        || distance < best.distance
        || (distance === best.distance && entry.text.length > best.entry.text.length)
      ) {
        best = { distance, entry };
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    governorateId: best.entry.governorateId,
    label: governorateLabel(best.entry),
    matchType: "fuzzy",
    matchedAlias: best.entry.text,
  };
};

/**
 * The value to store in `Order.governorate`: the numeric id as a string, which
 * is what the shipments filters and bulk edit already speak.
 */
export const resolveGovernorateValue = (address: unknown): string | null => {
  const match = matchGovernorate(address);
  if (!match || match.governorateId === null) {
    return null;
  }

  return String(match.governorateId);
};

/**
 * `true` only when the address is confidently inside Cairo or Giza. An address
 * that matches nothing counts as outside, so an unrecognized address never
 * downgrades an order to vendor delivery by accident.
 */
export const isInsideCairoGiza = (address: unknown): boolean => {
  const match = matchGovernorate(address);
  if (!match || match.governorateId === null) {
    return false;
  }

  return INSIDE_CAIRO_GIZA_IDS.includes(match.governorateId);
};

/** نفس الفحص لكن انطلاقاً من قيمة `governorate` المخزّنة (معرّف أو نص). */
export const isInsideCairoGizaValue = (governorate: unknown): boolean => {
  if (governorate === null || governorate === undefined || governorate === "") {
    return false;
  }

  const asNumber = Number(governorate);
  if (Number.isFinite(asNumber) && GOVERNORATES[String(asNumber)]) {
    return INSIDE_CAIRO_GIZA_IDS.includes(asNumber);
  }

  return isInsideCairoGiza(governorate);
};

/**
 * The Arabic name to show for a stored `governorate` value. Newer rows hold the
 * numeric id (what the filters and bulk edit speak), older ones hold free text,
 * so either shape has to resolve to a name.
 */
export const governorateDisplayLabel = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  return GOVERNORATES[String(Number(text))] ?? text;
};
