import type { SectionId } from "@/lib/tradeos/types";
import type { MessageKey } from "@/lib/regional/messages";

/** The recommended setup checklist shown in Setup & Data Import. Titles and descriptions are message keys rendered through t() by SetupImportHub. */
export const SETUP_STEPS: { titleKey: MessageKey; descriptionKey: MessageKey; section: SectionId; entities: string[]; optional?: boolean }[] = [
  { titleKey: "import.hub.step1Title", descriptionKey: "import.hub.step1Desc", section: "business-settings", entities: [] },
  { titleKey: "import.hub.step2Title", descriptionKey: "import.hub.step2Desc", section: "brands", entities: ["brands", "categories"] },
  { titleKey: "import.hub.step3Title", descriptionKey: "import.hub.step3Desc", section: "customers", entities: ["customers", "suppliers"] },
  { titleKey: "import.hub.step4Title", descriptionKey: "import.hub.step4Desc", section: "products", entities: ["products"] },
  { titleKey: "import.hub.step5Title", descriptionKey: "import.hub.step5Desc", section: "sales", entities: [], optional: true },
  { titleKey: "import.hub.step6Title", descriptionKey: "import.hub.step6Desc", section: "staff-permissions", entities: ["employees", "staff", "territories", "routes"], optional: true },
];
