// ASSUMPTION: class-validator is not available in this workspace; validation decorators omitted.
export class CreateTripDto {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
}
