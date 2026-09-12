// Minimal stubs for the parts of class-validator used in the codebase

export type ValidationOptions = {
  message?: string;
};

export interface ValidationArguments {
  value: any;
  targetName: string;
  object: any;
  property: string;
  constraints: any[];
}

/**
 * No‑op decorator factory used only for type checking.
 */
export function registerDecorator(config: {
  name: string;
  target: Function;
  propertyName: string;
  options?: ValidationOptions;
  validator: {
    validate(value: any, args: ValidationArguments): boolean;
  };
}) {
  // Intentionally empty – runtime behavior is not required for compilation.
}
