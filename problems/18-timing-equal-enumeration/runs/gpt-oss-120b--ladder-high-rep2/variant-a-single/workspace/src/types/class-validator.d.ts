declare module 'class-validator' {
  export function IsEmail(): PropertyDecorator;
  export function IsString(): PropertyDecorator;
  export function MinLength(length: number): PropertyDecorator;
}
