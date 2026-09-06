import "./validation-environment";
import { runAllGatewayValidations, printReport } from "../src/lib/conversation/validation";

runAllGatewayValidations().then((report) => {
  console.log(printReport(report));
  if (report.totalFailed > 0) process.exitCode = 1;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
