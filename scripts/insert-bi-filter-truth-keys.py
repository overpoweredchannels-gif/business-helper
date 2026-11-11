#!/usr/bin/env python3
"""Insert 3 new bi.* keys into src/lib/regional/messages.ts (all 4 blocks).

Anchors on the 'bi.operating' line of each language block; each anchor must
occur exactly once. After insertion each new key must occur exactly 4 times
(once per language block). Exits non-zero on any assertion failure.
"""
import sys

PATH = "src/lib/regional/messages.ts"

NEW_KEYS = {
    "en": [
        ("bi.allTimeBalancesNote", "Outstanding and overdue balances are all-time and ignore the selected date range."),
        ("bi.expenseProductNote", "Expenses are not linked to products or categories, so those filters do not change them."),
        ("bi.expenseStaffNote", "Expenses carry no staff attribution, so the staff filter does not change them."),
    ],
    "es": [
        ("bi.allTimeBalancesNote", "Los saldos pendientes y vencidos son de todo el historial e ignoran el rango de fechas seleccionado."),
        ("bi.expenseProductNote", "Los gastos no están vinculados a productos o categorías, por lo que esos filtros no los cambian."),
        ("bi.expenseStaffNote", "Los gastos no llevan atribución de personal, por lo que el filtro de personal no los cambia."),
    ],
    "it": [
        ("bi.allTimeBalancesNote", "I saldi in sospeso e scaduti riguardano l\\'intero storico e ignorano l\\'intervallo di date selezionato."),
        ("bi.expenseProductNote", "Le spese non sono collegate a prodotti o categorie, quindi quei filtri non le modificano."),
        ("bi.expenseStaffNote", "Le spese non hanno attribuzione al personale, quindi il filtro del personale non le modifica."),
    ],
    "ur": [
        ("bi.allTimeBalancesNote", "بقایا اور واجب الادا بیلنس تمام وقت کے ہیں اور منتخب تاریخ کی حد کو نظرانداز کرتے ہیں۔"),
        ("bi.expenseProductNote", "اخراجات مصنوعات یا زمروں سے منسلک نہیں ہیں، اس لیے وہ فلٹر انہیں تبدیل نہیں کرتے۔"),
        ("bi.expenseStaffNote", "اخراجات میں عملے کی نسبت نہیں ہوتی، اس لیے عملے کا فلٹر انہیں تبدیل نہیں کرتا۔"),
    ],
}

ANCHORS = {
    "en": ("  'bi.operating': 'Operating',", "  "),
    "es": ("    'bi.operating': 'Operativos',", "    "),
    "it": ("    'bi.operating': 'Operative',", "    "),
    "ur": ("    'bi.operating': 'عملی',", "    "),
}


def main() -> int:
    with open(PATH, encoding="utf-8") as f:
        text = f.read()

    for lang, (anchor, indent) in ANCHORS.items():
        count = text.count(anchor)
        assert count == 1, f"{lang}: anchor occurs {count} times, expected 1: {anchor!r}"
        lines = "".join(
            f"{indent}'{key}': '{value}',\n" for key, value in NEW_KEYS[lang]
        )
        text = text.replace(anchor, anchor + "\n" + lines.rstrip("\n"), 1)

    for key, _ in NEW_KEYS["en"]:
        count = text.count(f"'{key}':")
        assert count == 4, f"{key}: occurs {count} times, expected 4 (once per language block)"

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(text)
    print("OK: inserted 3 keys x 4 languages; each new key occurs 4 times")
    return 0


if __name__ == "__main__":
    sys.exit(main())
