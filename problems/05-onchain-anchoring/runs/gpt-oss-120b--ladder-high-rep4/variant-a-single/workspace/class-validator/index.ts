// Minimal stubs for the decorators used in DTOs.
// They do nothing at runtime but satisfy TypeScript imports.

export function IsString(): PropertyDecorator {
  return () => {};
}

export function IsInt(): PropertyDecorator {
  return () => {};
}

export function IsNotEmpty(): PropertyDecorator {
  return () => {};
}
