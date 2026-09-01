export type MayaEnvironment = "sandbox" | "production";

const MAYA_HOSTS: Record<MayaEnvironment, string> = {
  sandbox: "https://pg-sandbox.paymaya.com",
  production: "https://pg.paymaya.com",
};

export function getMayaEnvironment(): MayaEnvironment {
  const environment = process.env.MAYA_ENVIRONMENT?.trim().toLowerCase();
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(
      "MAYA_ENVIRONMENT must be set explicitly to sandbox or production.",
    );
  }
  return environment;
}

export function getMayaHost() {
  return MAYA_HOSTS[getMayaEnvironment()];
}
