// Test-environment defaults: the drift-repair scheduler must not fire while
// suites run (tests invoke the job explicitly). A real cadence can still be
// forced by setting DRIFT_REPAIR_INTERVAL_MS in the environment.
process.env.DRIFT_REPAIR_INTERVAL_MS = process.env.DRIFT_REPAIR_INTERVAL_MS ?? '0';
