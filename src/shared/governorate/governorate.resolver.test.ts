import {
  isInsideCairoGiza,
  isInsideCairoGizaValue,
  matchGovernorate,
  normalizeArabic,
  resolveGovernorateValue,
} from "./governorate.resolver";

describe("normalizeArabic", () => {
  it("folds alef, ya and ta-marbuta variants onto one spelling", () => {
    expect(normalizeArabic("الجيزة")).toBe(normalizeArabic("الجيزه"));
    expect(normalizeArabic("إسماعيلية")).toBe(normalizeArabic("اسماعيليه"));
    expect(normalizeArabic("المنيا")).toBe(normalizeArabic("المنيا"));
  });

  it("converts Arabic-Indic digits and strips punctuation", () => {
    expect(normalizeArabic("٦ أكتوبر، الجيزة")).toBe("6 اكتوبر الجيزه");
  });
});

describe("matchGovernorate", () => {
  it("matches the canonical label anywhere in the address", () => {
    const match = matchGovernorate("شارع التحرير - الدقي - الجيزة - مصر");
    expect(match?.governorateId).toBe(2);
    expect(match?.matchType).toBe("exact");
  });

  it("matches a well-known district instead of the governorate name", () => {
    expect(matchGovernorate("١٥ ش مصطفى النحاس، مدينة نصر")?.governorateId).toBe(1);
    expect(matchGovernorate("الحي المتميز، ٦ اكتوبر")?.governorateId).toBe(2);
    expect(matchGovernorate("شارع البحر، طنطا")?.governorateId).toBe(7);
  });

  it("tolerates a dropped or swapped letter", () => {
    const match = matchGovernorate("عمارة ٣، الاسكندريه الجديده");
    expect(match?.governorateId).toBe(3);

    const typo = matchGovernorate("منزل ٢، الاسماعيليه");
    expect(typo?.governorateId).toBe(18);
  });

  it("prefers the longer alias when two overlap", () => {
    expect(matchGovernorate("طريق العريش، شمال سيناء")?.governorateId).toBe(21);
    expect(matchGovernorate("خليج نعمة، جنوب سيناء")?.governorateId).toBe(22);
  });

  it("matches Latin spellings", () => {
    expect(matchGovernorate("12 Road 9, Maadi, Cairo, Egypt")?.governorateId).toBe(1);
    expect(matchGovernorate("Sheikh Zayed, Giza")?.governorateId).toBe(2);
  });

  it("recognizes a governorate that has no id of its own", () => {
    const match = matchGovernorate("شارع الجيش - كفر الشيخ");
    expect(match).not.toBeNull();
    expect(match?.governorateId).toBeNull();
  });

  it("returns null for an address with nothing recognizable", () => {
    expect(matchGovernorate("")).toBeNull();
    expect(matchGovernorate("--- ---")).toBeNull();
    expect(matchGovernorate("شارع ١٢ عمارة ٣ الدور الثالث")).toBeNull();
  });
});

describe("resolveGovernorateValue", () => {
  it("returns the governorate id as a string", () => {
    expect(resolveGovernorateValue("مدينة نصر، القاهرة")).toBe("1");
    expect(resolveGovernorateValue("سموحة، الاسكندرية")).toBe("3");
  });

  it("returns null when the governorate has no id or nothing matched", () => {
    expect(resolveGovernorateValue("دسوق، كفر الشيخ")).toBeNull();
    expect(resolveGovernorateValue("عنوان غير معروف")).toBeNull();
  });
});

describe("isInsideCairoGiza", () => {
  it("is true only for Cairo and Giza addresses", () => {
    expect(isInsideCairoGiza("التجمع الخامس، القاهرة الجديدة")).toBe(true);
    expect(isInsideCairoGiza("الشيخ زايد، الجيزة")).toBe(true);
    expect(isInsideCairoGiza("المنصورة، الدقهلية")).toBe(false);
  });

  it("treats an unrecognized address as outside", () => {
    expect(isInsideCairoGiza("")).toBe(false);
    expect(isInsideCairoGiza("عنوان بلا معالم")).toBe(false);
  });
});

describe("isInsideCairoGizaValue", () => {
  it("accepts both the stored id and the stored label", () => {
    expect(isInsideCairoGizaValue("1")).toBe(true);
    expect(isInsideCairoGizaValue(2)).toBe(true);
    expect(isInsideCairoGizaValue("القاهرة")).toBe(true);
    expect(isInsideCairoGizaValue("5")).toBe(false);
    expect(isInsideCairoGizaValue(null)).toBe(false);
  });
});

describe("«جسر السويس» is a Cairo district, not the Suez governorate", () => {
  it.each([
    "جسر السويس، القاهرة",
    "شارع جسر السويس - برج 5",
    "٥ ش الحجاز جسر السويس",
    "جسر السويس الجديد",
    "كوبري جسر السويس",
  ])("resolves %s to Cairo", (address) => {
    expect(matchGovernorate(address)?.governorateId).toBe(1);
    expect(isInsideCairoGiza(address)).toBe(true);
  });

  it("still resolves the Suez governorate when the address is really in Suez", () => {
    expect(matchGovernorate("السويس - حي الأربعين")?.governorateId).toBe(20);
    expect(matchGovernorate("محافظة السويس شارع الجيش")?.governorateId).toBe(20);
  });
});

describe("Latin spellings of Cairo/Giza/Alexandria areas", () => {
  it.each([
    ["b 6 group 65 3omara 78 12 C Madinaty Egypt ---مصر", 1],
    ["Villa 5, Rehab City, Egypt", 1],
    ["Tagamoa el Khames, New Cairo", 1],
    ["12 Zayed, Sheikh Zayed City", 2],
    ["6th October, El Hosary", 2],
    ["Smouha, Alexandria", 3],
  ])("resolves %s", (address, id) => {
    expect(matchGovernorate(address)?.governorateId).toBe(id);
  });

  it("does not guess when the address has no recognizable place", () => {
    expect(matchGovernorate("b 6 group 65 3omara 78 12 C Egypt")).toBeNull();
  });
});

describe("glued address tokens and the new capital", () => {
  it.each([
    "شقة 3 الدور الأول عمارة 6 الأندلس عائلي 5 منطقة 4التجمع الخامسCairo-Egypt",
    "79 zahra city 24 C Zahra new capital Egypt ---مصر",
    "العاصمة الإدارية الجديدة - الحي الثالث",
  ])("resolves %s to Cairo", (address) => {
    expect(matchGovernorate(address)?.governorateId).toBe(1);
  });
});
