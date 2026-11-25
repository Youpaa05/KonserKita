export function isPaymentSimulationEnabled(environment = process.env) {
  return environment.NODE_ENV === "development" &&
    environment.PAYMENT_SIMULATION_ENABLED === "true";
}
