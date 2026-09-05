# 05-create-trip.dto.ts

## reasoning

```
The plan specifies this file:

```ts
export class CreateTripDto {
  name: string;       // @IsString, @IsNotEmpty
  destination: string;// @IsString, @IsNotEmpty
  startDate: string;  // @IsDateString
  endDate: string;    // @IsDateString
}
```

The plan says the DTO class has validation decorators (`@IsString`, `@IsNotEmpty`, `@IsDateString`). These come from `class-validator`. The plan's manifest says this file "reads: -" meaning no other files, but it needs to import from `class-validator`.

Looking at the conventions in the task reference (variant-a.md), it mentions:
- "Controllers call services; services call repositories"
- The plan says the DTO uses validation decorators

The plan explicitly shows the class with comments indicating decorators. I need to write it with the actual `class-validator` decorators since that's what NestJS uses for DTO validation.

Let me write the complete file:

```ts
import { IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateTripDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  destination: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
```

This is exactly what the plan specifies. The plan's comments indicate `@IsString, @IsNotEmpty` for name and destination, and `@IsDateString` for startDate and endDate. The import from `class-validator` is standard NestJS convention for DTO validation.
```

## reply

```ts
import { IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateTripDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  destination: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
```
