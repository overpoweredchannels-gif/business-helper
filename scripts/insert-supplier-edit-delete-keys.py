#!/usr/bin/env python3
"""Insert 29 new suppliers.* keys into src/lib/regional/messages.ts (all 4 blocks).

Anchors on the 'suppliers.contactPrefix' line of each language block; each
anchor must occur exactly once. After insertion each new key must occur
exactly 4 times (once per language block). Exits non-zero on any assertion
failure.
"""
import sys

PATH = "src/lib/regional/messages.ts"

NEW_KEYS = {
    "en": [
        ("suppliers.areaLabel", "Area"),
        ("suppliers.creditLimitLabel", "Credit Limit"),
        ("suppliers.creditDaysLabel", "Credit Days"),
        ("suppliers.creditPolicyLabel", "Credit Policy"),
        ("suppliers.preferredPaymentLabel", "Preferred Payment Method"),
        ("suppliers.allowOverLimitLabel", "Allow over credit limit"),
        ("suppliers.allowOverdueSalesLabel", "Allow sales with overdue balance"),
        ("suppliers.outstandingPrefix", "Outstanding:"),
        ("suppliers.lastPurchasePrefix", "Last purchase:"),
        ("suppliers.creditPrefix", "Credit:"),
        ("suppliers.creditDaysSuffix", "days"),
        ("suppliers.showArchived", "Show archived"),
        ("suppliers.showRecycleBin", "Recycle bin"),
        ("suppliers.hideRecycleBin", "Hide recycle bin"),
        ("suppliers.recycleBinTitle", "Recycle Bin"),
        ("suppliers.noBinnedSuppliers", "Recycle bin is empty."),
        ("suppliers.deletedPrefix", "Deleted:"),
        ("suppliers.daysLeft", "{days} days left"),
        ("suppliers.readyForPermanentDelete", "Ready for permanent delete"),
        ("suppliers.deletePermanently", "Delete Permanently"),
        ("suppliers.archiveTitle", "Archive supplier?"),
        ("suppliers.archiveBody", "Archive {name}? The supplier leaves the active list and can be restored later."),
        ("suppliers.deleteToBinTitle", "Delete supplier?"),
        ("suppliers.deleteToBinBody", "Move {name} to the recycle bin? It stays there for 7 days and can be restored."),
        ("suppliers.permanentDeleteTitle", "Delete permanently?"),
        ("suppliers.permanentDeleteBody", "Permanently delete {name}? This cannot be undone."),
        ("suppliers.movedToBinOk", "Supplier moved to the recycle bin."),
        ("suppliers.permanentlyDeletedOk", "Supplier permanently deleted."),
        ("suppliers.supplierActionFailed", "Supplier action failed."),
    ],
    "es": [
        ("suppliers.areaLabel", "Zona"),
        ("suppliers.creditLimitLabel", "Límite de crédito"),
        ("suppliers.creditDaysLabel", "Días de crédito"),
        ("suppliers.creditPolicyLabel", "Política de crédito"),
        ("suppliers.preferredPaymentLabel", "Método de pago preferido"),
        ("suppliers.allowOverLimitLabel", "Permitir superar el límite de crédito"),
        ("suppliers.allowOverdueSalesLabel", "Permitir ventas con saldo vencido"),
        ("suppliers.outstandingPrefix", "Pendiente:"),
        ("suppliers.lastPurchasePrefix", "Última compra:"),
        ("suppliers.creditPrefix", "Crédito:"),
        ("suppliers.creditDaysSuffix", "días"),
        ("suppliers.showArchived", "Mostrar archivados"),
        ("suppliers.showRecycleBin", "Papelera"),
        ("suppliers.hideRecycleBin", "Ocultar papelera"),
        ("suppliers.recycleBinTitle", "Papelera"),
        ("suppliers.noBinnedSuppliers", "La papelera está vacía."),
        ("suppliers.deletedPrefix", "Eliminado:"),
        ("suppliers.daysLeft", "Quedan {days} días"),
        ("suppliers.readyForPermanentDelete", "Listo para eliminar definitivamente"),
        ("suppliers.deletePermanently", "Eliminar definitivamente"),
        ("suppliers.archiveTitle", "¿Archivar proveedor?"),
        ("suppliers.archiveBody", "¿Archivar {name}? El proveedor sale de la lista activa y se puede restaurar más tarde."),
        ("suppliers.deleteToBinTitle", "¿Eliminar proveedor?"),
        ("suppliers.deleteToBinBody", "¿Mover {name} a la papelera? Queda allí 7 días y se puede restaurar."),
        ("suppliers.permanentDeleteTitle", "¿Eliminar definitivamente?"),
        ("suppliers.permanentDeleteBody", "¿Eliminar definitivamente {name}? Esto no se puede deshacer."),
        ("suppliers.movedToBinOk", "Proveedor movido a la papelera."),
        ("suppliers.permanentlyDeletedOk", "Proveedor eliminado definitivamente."),
        ("suppliers.supplierActionFailed", "La acción del proveedor falló."),
    ],
    "it": [
        ("suppliers.areaLabel", "Zona"),
        ("suppliers.creditLimitLabel", "Limite di credito"),
        ("suppliers.creditDaysLabel", "Giorni di credito"),
        ("suppliers.creditPolicyLabel", "Politica di credito"),
        ("suppliers.preferredPaymentLabel", "Metodo di pagamento preferito"),
        ("suppliers.allowOverLimitLabel", "Consenti oltre il limite di credito"),
        ("suppliers.allowOverdueSalesLabel", "Consenti vendite con saldo scaduto"),
        ("suppliers.outstandingPrefix", "In sospeso:"),
        ("suppliers.lastPurchasePrefix", "Ultimo acquisto:"),
        ("suppliers.creditPrefix", "Credito:"),
        ("suppliers.creditDaysSuffix", "giorni"),
        ("suppliers.showArchived", "Mostra archiviati"),
        ("suppliers.showRecycleBin", "Cestino"),
        ("suppliers.hideRecycleBin", "Nascondi cestino"),
        ("suppliers.recycleBinTitle", "Cestino"),
        ("suppliers.noBinnedSuppliers", "Il cestino è vuoto."),
        ("suppliers.deletedPrefix", "Eliminato:"),
        ("suppliers.daysLeft", "Restano {days} giorni"),
        ("suppliers.readyForPermanentDelete", "Pronto per l\\'eliminazione definitiva"),
        ("suppliers.deletePermanently", "Elimina definitivamente"),
        ("suppliers.archiveTitle", "Archiviare il fornitore?"),
        ("suppliers.archiveBody", "Archiviare {name}? Il fornitore esce dalla lista attiva e può essere ripristinato in seguito."),
        ("suppliers.deleteToBinTitle", "Eliminare il fornitore?"),
        ("suppliers.deleteToBinBody", "Spostare {name} nel cestino? Resta lì 7 giorni e può essere ripristinato."),
        ("suppliers.permanentDeleteTitle", "Eliminare definitivamente?"),
        ("suppliers.permanentDeleteBody", "Eliminare definitivamente {name}? Questa azione non può essere annullata."),
        ("suppliers.movedToBinOk", "Fornitore spostato nel cestino."),
        ("suppliers.permanentlyDeletedOk", "Fornitore eliminato definitivamente."),
        ("suppliers.supplierActionFailed", "Azione fornitore non riuscita."),
    ],
    "ur": [
        ("suppliers.areaLabel", "علاقہ"),
        ("suppliers.creditLimitLabel", "کریڈٹ کی حد"),
        ("suppliers.creditDaysLabel", "کریڈٹ کے دن"),
        ("suppliers.creditPolicyLabel", "کریڈٹ پالیسی"),
        ("suppliers.preferredPaymentLabel", "پسندیدہ ادائیگی کا طریقہ"),
        ("suppliers.allowOverLimitLabel", "کریڈٹ کی حد سے زیادہ کی اجازت دیں"),
        ("suppliers.allowOverdueSalesLabel", "واجب الادا بیلنس کے ساتھ فروخت کی اجازت دیں"),
        ("suppliers.outstandingPrefix", "بقایا:"),
        ("suppliers.lastPurchasePrefix", "آخری خریداری:"),
        ("suppliers.creditPrefix", "کریڈٹ:"),
        ("suppliers.creditDaysSuffix", "دن"),
        ("suppliers.showArchived", "محفوظ شدہ دکھائیں"),
        ("suppliers.showRecycleBin", "ری سائیکل بن"),
        ("suppliers.hideRecycleBin", "ری سائیکل بن چھپائیں"),
        ("suppliers.recycleBinTitle", "ری سائیکل بن"),
        ("suppliers.noBinnedSuppliers", "ری سائیکل بن خالی ہے۔"),
        ("suppliers.deletedPrefix", "حذف شدہ:"),
        ("suppliers.daysLeft", "{days} دن باقی"),
        ("suppliers.readyForPermanentDelete", "مستقل حذف کے لیے تیار"),
        ("suppliers.deletePermanently", "مستقل طور پر حذف کریں"),
        ("suppliers.archiveTitle", "سپلائر محفوظ کریں؟"),
        ("suppliers.archiveBody", "{name} کو محفوظ کریں؟ سپلائر فعال فہرست سے نکل جائے گا اور بعد میں بحال کیا جا سکتا ہے۔"),
        ("suppliers.deleteToBinTitle", "سپلائر حذف کریں؟"),
        ("suppliers.deleteToBinBody", "{name} کو ری سائیکل بن میں منتقل کریں؟ یہ 7 دن تک وہاں رہے گا اور بحال کیا جا سکتا ہے۔"),
        ("suppliers.permanentDeleteTitle", "مستقل طور پر حذف کریں؟"),
        ("suppliers.permanentDeleteBody", "{name} کو مستقل طور پر حذف کریں؟ یہ واپس نہیں ہو سکتا۔"),
        ("suppliers.movedToBinOk", "سپلائر ری سائیکل بن میں منتقل کر دیا گیا۔"),
        ("suppliers.permanentlyDeletedOk", "سپلائر مستقل طور پر حذف کر دیا گیا۔"),
        ("suppliers.supplierActionFailed", "سپلائر کی کارروائی ناکام رہی۔"),
    ],
}

ANCHORS = {
    "en": ("  'suppliers.contactPrefix': 'Contact:',", "  "),
    "es": ("    'suppliers.contactPrefix': 'Contacto:',", "    "),
    "it": ("    'suppliers.contactPrefix': 'Contatto:',", "    "),
    "ur": ("    'suppliers.contactPrefix': 'رابطہ:',", "    "),
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
    print("OK: inserted 29 keys x 4 languages; each new key occurs 4 times")
    return 0


if __name__ == "__main__":
    sys.exit(main())
