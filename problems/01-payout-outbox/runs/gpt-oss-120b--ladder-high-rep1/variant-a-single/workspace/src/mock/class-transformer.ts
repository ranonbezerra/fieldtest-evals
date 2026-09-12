// Minimal stub for the Transform decorator used in DTOs

export function Transform(transformFn: (params: { value: any }) => any) {
  return function (target: any, propertyKey: string) {
    // No runtime implementation needed for type checking.
  };
}
