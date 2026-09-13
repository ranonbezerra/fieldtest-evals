import { Controller, Post, Get, Body } from "@nestjs/common";
import { SynonymService } from "./synonym.service.js";

@Controller("synonyms")
export class SynonymController {
  constructor(private readonly synonymService: SynonymService) {}

  @Post()
  create(
    @Body("alternateName") alternateName: string,
    @Body("ingredientName") ingredientName: string,
  ) {
    return this.synonymService.create(alternateName, ingredientName);
  }

  @Get()
  getAll() {
    return this.synonymService.getAll();
  }
}
