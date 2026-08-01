import { generateReport, printReport, type ValidationReport } from "@/lib/brain/validation/helpers";
import { validateGateway } from "./validate-gateway";

export async function runAllGatewayValidations(): Promise<ValidationReport> {
  const suites = await Promise.all([
    validateGateway(),
  ]);
  return generateReport(suites);
}

export { printReport };
