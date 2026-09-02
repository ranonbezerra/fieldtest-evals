import { Body, Controller, Post } from "@nestjs/common";
import { ReDeriveInput } from "../operations/operations.types";
import { ReDerivationService } from "./re-derivation.service";

@Controller("operations")
export class ReDerivationController {
  constructor(private readonly service: ReDerivationService) {}

  @Post("re-derive")
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    return this.service.reDerive(input);
  }
}
