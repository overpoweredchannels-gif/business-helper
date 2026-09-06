import "./validation-environment";
import { runAllValidations, printReport } from "../src/lib/brain/validation";

runAllValidations().then((report) => {
  console.log(printReport(report));
  if (report.totalFailed > 0) process.exitCode = 1;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
