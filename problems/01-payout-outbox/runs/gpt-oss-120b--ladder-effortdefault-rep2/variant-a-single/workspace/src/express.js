// Minimal stub for Express json middleware used in main.ts
export function json(options) {
  return (req, res, next) => {
    // No-op middleware for testing purposes
    next();
  };
}
