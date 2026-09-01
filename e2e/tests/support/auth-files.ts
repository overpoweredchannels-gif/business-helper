import path from "node:path";

export const authFiles = {
  owner: path.resolve(__dirname, "../../.auth/owner.json"),
  manager: path.resolve(__dirname, "../../.auth/manager.json"),
  employee: path.resolve(__dirname, "../../.auth/employee.json"),
};
